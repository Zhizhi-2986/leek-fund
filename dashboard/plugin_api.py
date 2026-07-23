"""Private REST backend for the LeekFund Hermes Desktop plugin.

Hermes mounts this router at ``/api/plugins/leek-fund``. The Desktop renderer
uses ``ctx.rest`` to reach these endpoints, keeping market requests and local
state out of the browser process.
"""

from __future__ import annotations

import copy
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib import parse as urllib_parse
from urllib import request as urllib_request

try:
    from hermes_constants import get_hermes_home
except ImportError:

    def get_hermes_home() -> Path:
        configured = os.environ.get("HERMES_HOME", "").strip()
        return Path(configured) if configured else Path.home() / ".hermes"


try:
    from fastapi import APIRouter, HTTPException
except ImportError:

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class APIRouter:
        def _decorator(self, *_args, **_kwargs):
            return lambda fn: fn

        get = _decorator
        post = _decorator
        patch = _decorator
        delete = _decorator


router = APIRouter()

PLUGIN_ID = "leek-fund"
STATE_VERSION = 2
DEFAULT_STOCKS = [
    "sh000001",
    "sh000300",
    "sh000016",
    "sh000688",
    "hk03690",
    "hk00700",
    "usr_ixic",
    "usr_dji",
    "usr_inx",
]
DEFAULT_INDEX_CODES = ["sh000001", "sz399006", "sh000680", "b_NKY", "b_KOSPI"]
CATEGORY_ORDER = ["A", "HK", "US"]
VISIBLE_CATEGORY_ORDER = ["A"]
CATEGORY_LABELS = {"A": "A 股", "HK": "港股", "US": "美股"}
TENCENT_STOCK_SEARCH_URL = (
    "https://proxy.finance.qq.com/ifzqgtimg/appstock/smartbox/search/get"
)
BUILTIN_GROUPS = [
    ("holding", "持仓股"),
    ("watch", "关注"),
    ("ungrouped", "未分组"),
]
CODE_PATTERN = re.compile(
    r"^(?:(?:sh|sz|bj)\d{6}|hk\d{5}|(?:usr_|gb_)[a-z0-9._-]+)$",
    re.IGNORECASE,
)
SINA_LINE_PATTERN = re.compile(r'^var hq_str_([^=]+)="([^"]*)";?$', re.MULTILINE)
STATE_LOCK = threading.RLock()
SNAPSHOT_LOCK = threading.RLock()


def plugin_data_dir() -> Path:
    return get_hermes_home() / "plugins" / PLUGIN_ID / "data"


def state_path() -> Path:
    return plugin_data_dir() / "state.json"


def market_cache_path() -> Path:
    return plugin_data_dir() / "market_snapshot.json"


def default_state() -> Dict[str, Any]:
    return {
        "schema_version": STATE_VERSION,
        "stocks": list(DEFAULT_STOCKS),
        "groups": [],
        "holding_codes": [],
        "watch_codes": [],
        "status_bar_stock_codes": [],
    }


def _dedupe(values: Iterable[str]) -> List[str]:
    result: List[str] = []
    seen = set()
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def normalize_code(value: Any) -> str:
    code = str(value or "").strip().replace("$", ".")
    if not code:
        return ""
    if code.startswith("hk"):
        code = code.lower()
    elif code.lower().startswith(("usr_", "gb_")):
        code = code.lower()
    else:
        code = code.lower()
    if not CODE_PATTERN.fullmatch(code):
        return ""
    return code


def category_of(code: str) -> Optional[str]:
    if code.startswith(("sh", "sz", "bj")):
        return "A"
    if code.startswith("hk"):
        return "HK"
    if code.startswith(("usr_", "gb_")):
        return "US"
    return None


def _normalize_group(group: Any, stocks: set[str]) -> Optional[Dict[str, Any]]:
    if not isinstance(group, dict):
        return None
    group_id = str(group.get("id") or "").strip()
    name = str(group.get("name") or "").strip()
    category = str(group.get("category") or "").upper()
    if not group_id or not name or category not in CATEGORY_ORDER:
        return None
    codes = [
        code
        for code in (normalize_code(item) for item in group.get("stock_codes", []))
        if code and code in stocks and category_of(code) == category
    ]
    parent_id = str(group.get("parent_id") or "").strip()
    normalized = {
        "id": group_id,
        "name": name,
        "category": category,
        "stock_codes": _dedupe(codes),
    }
    if parent_id and parent_id != group_id:
        normalized["parent_id"] = parent_id
    return normalized


def _normalize_groups(groups: Any, stocks: set[str]) -> List[Dict[str, Any]]:
    if not isinstance(groups, list):
        return []
    candidates: List[Dict[str, Any]] = []
    seen_ids = set()
    for group in groups:
        normalized = _normalize_group(group, stocks)
        if not normalized or normalized["id"] in seen_ids:
            continue
        seen_ids.add(normalized["id"])
        candidates.append(normalized)

    group_map = {group["id"]: group for group in candidates}
    result: List[Dict[str, Any]] = []
    for group in candidates:
        parent_id = group.get("parent_id")
        if not parent_id:
            result.append(group)
            continue
        parent = group_map.get(parent_id)
        if (
            not parent
            or parent.get("parent_id")
            or parent["category"] != group["category"]
        ):
            continue
        result.append(group)
    return result


def normalize_state(raw: Any) -> Dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    stocks = _dedupe(
        code
        for code in (normalize_code(item) for item in source.get("stocks", DEFAULT_STOCKS))
        if code
    )
    stock_set = set(stocks)
    groups = _normalize_groups(source.get("groups", []), stock_set)

    def normalize_stock_subset(key: str) -> List[str]:
        return _dedupe(
            code
            for code in (normalize_code(item) for item in source.get(key, []))
            if code and code in stock_set
        )

    return {
        "schema_version": STATE_VERSION,
        "stocks": stocks,
        "groups": groups,
        "holding_codes": normalize_stock_subset("holding_codes"),
        "watch_codes": normalize_stock_subset("watch_codes"),
        "status_bar_stock_codes": normalize_stock_subset("status_bar_stock_codes"),
    }


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return copy.deepcopy(default)


def _write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    temporary.replace(path)


def load_state() -> Dict[str, Any]:
    with STATE_LOCK:
        return normalize_state(_read_json(state_path(), default_state()))


def save_state(state: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_state(state)
    with STATE_LOCK:
        _write_json_atomic(state_path(), normalized)
    return normalized


def mutate_state(mutator: Callable[[Dict[str, Any]], None]) -> Dict[str, Any]:
    with STATE_LOCK:
        state = load_state()
        mutator(state)
        return save_state(state)


def _http_get(url: str, timeout: int = 8) -> bytes:
    req = urllib_request.Request(
        url,
        headers={
            "Accept": "*/*",
            "Referer": "http://finance.sina.com.cn/",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
            ),
        },
    )
    with urllib_request.urlopen(req, timeout=timeout) as response:
        return response.read()


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        return result if result == result else default
    except (TypeError, ValueError):
        return default


def _formatted(value: float, digits: int = 2) -> str:
    return f"{value:.{digits}f}"


def _quote(
    code: str,
    name: str,
    price: Any,
    yestclose: Any,
    *,
    open_price: Any = 0,
    high: Any = 0,
    low: Any = 0,
    time_text: str = "",
) -> Optional[Dict[str, Any]]:
    price_value = _number(price)
    close_value = _number(yestclose)
    if not name or price_value <= 0:
        return None
    updown_value = price_value - close_value
    percent_value = (updown_value / close_value * 100) if close_value else 0.0
    return {
        "code": code,
        "name": name,
        "price": _formatted(price_value, 3 if price_value < 1 else 2),
        "yestclose": _formatted(close_value, 3 if close_value < 1 else 2),
        "open": _formatted(_number(open_price), 3 if price_value < 1 else 2),
        "high": _formatted(_number(high), 3 if price_value < 1 else 2),
        "low": _formatted(_number(low), 3 if price_value < 1 else 2),
        "updown": _formatted(updown_value, 3 if price_value < 1 else 2),
        "percent": f"{percent_value:+.2f}",
        "time": time_text,
        "available": True,
    }


def _parse_sina_cn(code: str, params: List[str]) -> Optional[Dict[str, Any]]:
    if len(params) <= 5:
        return None
    price = params[3]
    if _number(price) == 0:
        price = params[6] if len(params) > 6 and _number(params[6]) else params[2]
    time_text = " ".join(item for item in params[30:32] if item)
    return _quote(
        code,
        params[0],
        price,
        params[2],
        open_price=params[1],
        high=params[4],
        low=params[5],
        time_text=time_text,
    )


def _parse_sina_us(code: str, params: List[str]) -> Optional[Dict[str, Any]]:
    if len(params) <= 26:
        return None
    return _quote(
        code,
        params[0],
        params[1],
        params[26],
        open_price=params[5],
        high=params[6],
        low=params[7],
        time_text=params[3],
    )


def _parse_sina_global_index(code: str, params: List[str]) -> Optional[Dict[str, Any]]:
    if code.startswith("int_"):
        if len(params) <= 3:
            return None
        price = _number(params[1])
        yestclose = price - _number(params[2])
        return _quote(
            code,
            params[0],
            price,
            yestclose,
            open_price=price,
            high=price,
            low=price,
        )
    if len(params) <= 11:
        return None
    price = _number(params[1])
    yestclose = price - _number(params[2])
    return _quote(
        code,
        params[0],
        price,
        yestclose,
        open_price=params[8] or price,
        high=params[10] or price,
        low=params[11] or price,
        time_text=" ".join(item for item in [params[6], params[7] or params[5]] if item),
    )


def fetch_sina_quotes(codes: List[str]) -> Dict[str, Dict[str, Any]]:
    if not codes:
        return {}
    requested = ",".join(code.replace(".", "$") for code in _dedupe(codes))
    url = f"https://hq.sinajs.cn/list={requested}"
    body = _http_get(url).decode("gb18030", errors="replace")
    result: Dict[str, Dict[str, Any]] = {}
    for match in SINA_LINE_PATTERN.finditer(body):
        raw_code = match.group(1).replace("$", ".")
        params = match.group(2).split(",")
        if not params or not params[0]:
            continue
        if raw_code.startswith(("b_", "int_")):
            item = _parse_sina_global_index(raw_code, params)
        else:
            normalized = normalize_code(raw_code)
            if not normalized:
                continue
            item = (
                _parse_sina_us(normalized, params)
                if normalized.startswith(("usr_", "gb_"))
                else _parse_sina_cn(normalized, params)
            )
        if item:
            result[item["code"]] = item
    return result


def fetch_hk_quotes(codes: List[str]) -> Dict[str, Dict[str, Any]]:
    normalized_codes = [normalize_code(code) for code in codes]
    normalized_codes = [code for code in normalized_codes if code.startswith("hk")]
    if not normalized_codes:
        return {}
    query = ",".join(f"r_{code}" for code in normalized_codes)
    raw = _http_get(f"https://qt.gtimg.cn/q={query}&fmt=json")
    payload = json.loads(raw.decode("gbk", errors="replace"))
    result: Dict[str, Dict[str, Any]] = {}
    for code in normalized_codes:
        params = payload.get(f"r_{code}")
        if not isinstance(params, list) or len(params) <= 37:
            continue
        item = _quote(
            code,
            str(params[1]),
            params[3],
            params[4],
            open_price=params[5],
            high=params[33],
            low=params[34],
            time_text=str(params[30]),
        )
        if item:
            result[code] = item
    return result


def parse_tencent_stock_search(payload: Any) -> List[Dict[str, str]]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    candidates = data.get("stock", []) if isinstance(data, dict) else []
    result: List[Dict[str, str]] = []
    seen_codes = set()
    for candidate in candidates:
        if not isinstance(candidate, list) or len(candidate) < 3:
            continue
        market = str(candidate[0] or "").strip().lower()
        code = normalize_code(f"{market}{candidate[1]}")
        name = str(candidate[2] or "").strip()
        if market not in {"sh", "sz", "bj"} or not code or not name:
            continue
        if code in seen_codes:
            continue
        seen_codes.add(code)
        result.append({"code": code, "name": name})
    return result


def search_a_stocks(keyword: str) -> List[Dict[str, str]]:
    query = str(keyword or "").strip()
    if not query:
        return []
    url = f"{TENCENT_STOCK_SEARCH_URL}?{urllib_parse.urlencode({'q': query})}"
    payload = json.loads(_http_get(url).decode("utf-8", errors="replace"))
    return parse_tencent_stock_search(payload)


def _load_market_cache() -> Dict[str, Any]:
    cached = _read_json(market_cache_path(), {})
    return cached if isinstance(cached, dict) else {}


def _save_market_cache(quotes: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    payload = {
        "updated_at": int(time.time()),
        "quotes": quotes,
    }
    _write_json_atomic(market_cache_path(), payload)
    return payload


def refresh_quotes(state: Dict[str, Any]) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    with SNAPSHOT_LOCK:
        cached = _load_market_cache()
        cached_quotes = cached.get("quotes", {})
        quotes = dict(cached_quotes) if isinstance(cached_quotes, dict) else {}
        errors: List[str] = []
        fetched_count = 0
        sina_codes = [
            code for code in state["stocks"] if category_of(code) == "A"
        ]
        sina_codes.extend(DEFAULT_INDEX_CODES)

        try:
            fetched = fetch_sina_quotes(sina_codes)
            quotes.update(fetched)
            fetched_count += len(fetched)
        except Exception as exc:
            errors.append(f"新浪行情请求失败：{exc}")

        cache = _save_market_cache(quotes) if fetched_count else cached
        return quotes, {
            "stale": bool(errors),
            "errors": errors,
            "updated_at": cache.get("updated_at"),
        }


def _stock_view(
    code: str,
    quotes: Dict[str, Dict[str, Any]],
    state: Dict[str, Any],
) -> Dict[str, Any]:
    item = copy.deepcopy(
        quotes.get(code)
        or {
            "code": code,
            "name": code,
            "price": "--",
            "percent": "--",
            "updown": "--",
            "time": "",
            "available": False,
        }
    )
    item["holding"] = code in state["holding_codes"]
    item["watch"] = code in state["watch_codes"]
    item["in_status_bar"] = code in state["status_bar_stock_codes"]
    return item


def build_categories(
    state: Dict[str, Any],
    quotes: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    categories: List[Dict[str, Any]] = []
    for category in VISIBLE_CATEGORY_ORDER:
        category_codes = [
            code for code in state["stocks"] if category_of(code) == category
        ]
        custom_groups = [
            group for group in state["groups"] if group["category"] == category
        ]
        grouped_codes = {
            code for group in custom_groups for code in group["stock_codes"]
        }
        builtin_code_map = {
            "holding": [
                code for code in state["holding_codes"] if category_of(code) == category
            ],
            "watch": [
                code for code in state["watch_codes"] if category_of(code) == category
            ],
            "ungrouped": [
                code for code in category_codes if code not in grouped_codes
            ],
        }
        groups: List[Dict[str, Any]] = []
        for group_id, label in BUILTIN_GROUPS:
            groups.append(
                {
                    "id": group_id,
                    "name": label,
                    "builtin": True,
                    "stocks": [
                        _stock_view(code, quotes, state)
                        for code in builtin_code_map[group_id]
                    ],
                }
            )
        group_views: Dict[str, Dict[str, Any]] = {}
        for group in custom_groups:
            group_views[group["id"]] = {
                "id": group["id"],
                "name": group["name"],
                "builtin": False,
                "parent_id": group.get("parent_id"),
                "stocks": [
                    _stock_view(code, quotes, state)
                    for code in group["stock_codes"]
                ],
                "children": [],
            }
        for group in custom_groups:
            view = group_views[group["id"]]
            parent_id = group.get("parent_id")
            if parent_id:
                group_views[parent_id]["children"].append(view)
            else:
                groups.append(view)

        def set_group_count(group: Dict[str, Any]) -> set[str]:
            codes = {stock["code"] for stock in group["stocks"]}
            for child in group.get("children", []):
                codes.update(set_group_count(child))
            group["count"] = len(codes)
            return codes

        for group in groups:
            group["children"] = group.get("children", [])
            set_group_count(group)
        categories.append(
            {
                "id": category,
                "name": CATEGORY_LABELS[category],
                "count": len(category_codes),
                "groups": groups,
            }
        )
    return categories


def build_snapshot() -> Dict[str, Any]:
    state = load_state()
    quotes, market_status = refresh_quotes(state)
    status_codes = _dedupe(
        DEFAULT_INDEX_CODES
        + [
            code
            for code in state["status_bar_stock_codes"]
            if category_of(code) == "A"
        ]
    )
    status_bar = [
        _stock_view(code, quotes, state)
        for code in status_codes
    ]
    return {
        "success": True,
        "categories": build_categories(state, quotes),
        "status_bar": status_bar,
        "updated_at": market_status["updated_at"],
        "stale": market_status["stale"],
        "errors": market_status["errors"],
    }


def _require_code(value: Any) -> str:
    code = normalize_code(value)
    if not code:
        raise HTTPException(status_code=400, detail="股票代码格式不正确。")
    return code


def _require_group(state: Dict[str, Any], group_id: str) -> Dict[str, Any]:
    group = next((item for item in state["groups"] if item["id"] == group_id), None)
    if not group:
        raise HTTPException(status_code=404, detail="未找到股票分组。")
    return group


def _require_placement(value: Any) -> str:
    placement = str(value or "").strip().lower()
    if placement not in {"before", "after"}:
        raise HTTPException(status_code=400, detail="拖动目标位置不正确。")
    return placement


def _insert_relative(
    values: List[str],
    item: str,
    target: str,
    placement: str,
) -> List[str]:
    if item == target:
        return list(values)
    result = [value for value in values if value != item]
    if not target:
        result.append(item)
        return result
    try:
        target_index = result.index(target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="未找到拖动目标。") from exc
    if placement == "after":
        target_index += 1
    result.insert(target_index, item)
    return result


@router.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "plugin": PLUGIN_ID, "version": "0.1.0"}


@router.get("/snapshot")
def snapshot() -> Dict[str, Any]:
    return build_snapshot()


@router.get("/stock-search")
def stock_search(q: str = "") -> Dict[str, Any]:
    query = str(q or "").strip()
    if not query:
        return {"items": []}
    try:
        return {"items": search_a_stocks(query)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"股票查询失败：{exc}") from exc


@router.post("/stocks")
def add_stock(body: Dict[str, Any]) -> Dict[str, Any]:
    code = _require_code(body.get("code"))

    def change(state: Dict[str, Any]) -> None:
        if code not in state["stocks"]:
            state["stocks"].append(code)

    state = mutate_state(change)
    return {"ok": True, "state": state}


@router.delete("/stocks/{code}")
def delete_stock(code: str) -> Dict[str, Any]:
    normalized = _require_code(code)

    def change(state: Dict[str, Any]) -> None:
        state["stocks"] = [item for item in state["stocks"] if item != normalized]
        for key in ["holding_codes", "watch_codes", "status_bar_stock_codes"]:
            state[key] = [item for item in state[key] if item != normalized]
        for group in state["groups"]:
            group["stock_codes"] = [
                item for item in group["stock_codes"] if item != normalized
            ]

    state = mutate_state(change)
    return {"ok": True, "state": state}


@router.post("/groups")
def create_group(body: Dict[str, Any]) -> Dict[str, Any]:
    category = str(body.get("category") or "").upper()
    name = str(body.get("name") or "").strip()
    if category not in CATEGORY_ORDER:
        raise HTTPException(status_code=400, detail="股票市场分类不正确。")
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空。")
    new_group = {
        "id": f"group-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}",
        "name": name,
        "category": category,
        "stock_codes": [],
    }

    def change(state: Dict[str, Any]) -> None:
        duplicate = any(
            item["category"] == category
            and not item.get("parent_id")
            and item["name"] == name
            for item in state["groups"]
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="同一市场下已存在同名分组。")
        state["groups"].append(new_group)

    state = mutate_state(change)
    return {"ok": True, "group": new_group, "state": state}


@router.patch("/groups/{group_id}")
def rename_group(group_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空。")

    def change(state: Dict[str, Any]) -> None:
        group = _require_group(state, group_id)
        duplicate = any(
            item["id"] != group_id
            and item["category"] == group["category"]
            and item.get("parent_id") == group.get("parent_id")
            and item["name"] == name
            for item in state["groups"]
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="同一市场下已存在同名分组。")
        group["name"] = name

    state = mutate_state(change)
    return {"ok": True, "state": state}


@router.delete("/groups/{group_id}")
def delete_group(group_id: str) -> Dict[str, Any]:
    def change(state: Dict[str, Any]) -> None:
        _require_group(state, group_id)
        deleted_ids = {
            group_id,
            *[
                group["id"]
                for group in state["groups"]
                if group.get("parent_id") == group_id
            ],
        }
        state["groups"] = [
            group for group in state["groups"] if group["id"] not in deleted_ids
        ]

    state = mutate_state(change)
    return {"ok": True, "state": state}


@router.post("/groups/{group_id}/reorder")
def reorder_group(group_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    target_group_id = str(body.get("target_group_id") or "").strip()
    placement = _require_placement(body.get("placement"))
    if not target_group_id:
        raise HTTPException(status_code=400, detail="拖动目标分组不能为空。")

    def change(state: Dict[str, Any]) -> None:
        group = _require_group(state, group_id)
        target = _require_group(state, target_group_id)
        if group["id"] == target["id"]:
            return
        if (
            group["category"] != target["category"]
            or group.get("parent_id") != target.get("parent_id")
        ):
            raise HTTPException(
                status_code=400,
                detail="只能在同一层级内调整分组顺序。",
            )
        groups = [item for item in state["groups"] if item["id"] != group_id]
        target_index = next(
            index
            for index, item in enumerate(groups)
            if item["id"] == target_group_id
        )
        if placement == "after":
            target_index += 1
        groups.insert(target_index, group)
        state["groups"] = groups

    state = mutate_state(change)
    return {"ok": True, "state": state}


@router.post("/stocks/{code}/group")
def move_stock(code: str, body: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _require_code(code)
    target_group_id = str(body.get("group_id") or "").strip()

    def change(state: Dict[str, Any]) -> None:
        if normalized not in state["stocks"]:
            raise HTTPException(status_code=404, detail="股票不在当前自选列表中。")
        category = category_of(normalized)
        for group in state["groups"]:
            if group["category"] == category:
                group["stock_codes"] = [
                    item for item in group["stock_codes"] if item != normalized
                ]
        if target_group_id and target_group_id != "ungrouped":
            target = _require_group(state, target_group_id)
            if target["category"] != category:
                raise HTTPException(status_code=400, detail="不能跨市场移动股票。")
            target["stock_codes"].append(normalized)

    state = mutate_state(change)
    return {"ok": True, "state": state}


@router.post("/stocks/{code}/reorder")
def reorder_stock(code: str, body: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _require_code(code)
    target_group_id = str(body.get("target_group_id") or "").strip()
    target_code_raw = str(body.get("target_code") or "").strip()
    target_code = _require_code(target_code_raw) if target_code_raw else ""
    placement = _require_placement(body.get("placement"))
    if not target_group_id:
        raise HTTPException(status_code=400, detail="拖动目标分组不能为空。")

    def change(state: Dict[str, Any]) -> None:
        if normalized not in state["stocks"]:
            raise HTTPException(status_code=404, detail="股票不在当前自选列表中。")
        category = category_of(normalized)
        overlay_key = {
            "holding": "holding_codes",
            "watch": "watch_codes",
        }.get(target_group_id)
        if overlay_key:
            overlay_codes = state[overlay_key]
            if normalized not in overlay_codes:
                raise HTTPException(
                    status_code=400,
                    detail="股票不在当前叠加列表中。",
                )
            if target_code and (
                target_code not in overlay_codes
                or category_of(target_code) != category
            ):
                raise HTTPException(
                    status_code=400,
                    detail="拖动目标股票不在当前叠加列表中。",
                )
            state[overlay_key] = _insert_relative(
                overlay_codes,
                normalized,
                target_code,
                placement,
            )
            return

        target_group = None
        if target_group_id != "ungrouped":
            target_group = _require_group(state, target_group_id)
            if target_group["category"] != category:
                raise HTTPException(status_code=400, detail="不能跨市场移动股票。")

        if target_code:
            if target_code == normalized:
                return
            if target_code not in state["stocks"] or category_of(target_code) != category:
                raise HTTPException(status_code=400, detail="拖动目标股票不正确。")
            if target_group:
                if target_code not in target_group["stock_codes"]:
                    raise HTTPException(
                        status_code=400,
                        detail="目标股票不在目标分组中。",
                    )
            else:
                target_is_grouped = any(
                    target_code in group["stock_codes"]
                    for group in state["groups"]
                    if group["category"] == category
                )
                if target_is_grouped:
                    raise HTTPException(
                        status_code=400,
                        detail="目标股票不在未分组列表中。",
                    )

        for group in state["groups"]:
            if group["category"] == category:
                group["stock_codes"] = [
                    item for item in group["stock_codes"] if item != normalized
                ]

        if target_group:
            target_group["stock_codes"] = _insert_relative(
                target_group["stock_codes"],
                normalized,
                target_code,
                placement,
            )
        else:
            state["stocks"] = _insert_relative(
                state["stocks"],
                normalized,
                target_code,
                placement,
            )

    state = mutate_state(change)
    return {"ok": True, "state": state}


@router.post("/stocks/{code}/flags")
def update_stock_flags(code: str, body: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _require_code(code)
    key_map = {
        "holding": "holding_codes",
        "watch": "watch_codes",
        "status_bar": "status_bar_stock_codes",
    }

    def change(state: Dict[str, Any]) -> None:
        if normalized not in state["stocks"]:
            raise HTTPException(status_code=404, detail="股票不在当前自选列表中。")
        for body_key, state_key in key_map.items():
            if body_key not in body:
                continue
            enabled = bool(body[body_key])
            values = [item for item in state[state_key] if item != normalized]
            if enabled:
                values.append(normalized)
            state[state_key] = values

    state = mutate_state(change)
    return {"ok": True, "state": state}
