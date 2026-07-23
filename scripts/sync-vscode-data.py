#!/usr/bin/env python3

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_API_PATH = REPO_ROOT / "dashboard" / "plugin_api.py"
VSCODE_EXTENSION_STATE_KEY = "Zhizhi.stockInfo"
CATEGORY_MAP = {
    "A Stock": "A",
    "HK Stock": "HK",
    "US Stock": "US",
}


def _load_plugin_api():
    spec = importlib.util.spec_from_file_location(
        "leek_fund_sync_plugin_api", PLUGIN_API_PATH
    )
    if not spec or not spec.loader:
        raise RuntimeError(f"无法加载 Hermes 状态模型：{PLUGIN_API_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


plugin_api = _load_plugin_api()


def _strip_json_comments(text: str) -> str:
    output: List[str] = []
    index = 0
    in_string = False
    escaped = False
    while index < len(text):
        char = text[index]
        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            output.append(char)
            index += 1
            continue
        if char == "/" and index + 1 < len(text):
            next_char = text[index + 1]
            if next_char == "/":
                index += 2
                while index < len(text) and text[index] not in "\r\n":
                    index += 1
                continue
            if next_char == "*":
                index += 2
                while index + 1 < len(text) and text[index : index + 2] != "*/":
                    if text[index] in "\r\n":
                        output.append(text[index])
                    index += 1
                index = min(index + 2, len(text))
                continue
        output.append(char)
        index += 1
    return "".join(output)


def _strip_trailing_commas(text: str) -> str:
    output: List[str] = []
    index = 0
    in_string = False
    escaped = False
    while index < len(text):
        char = text[index]
        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            output.append(char)
            index += 1
            continue
        if char == ",":
            lookahead = index + 1
            while lookahead < len(text) and text[lookahead].isspace():
                lookahead += 1
            if lookahead < len(text) and text[lookahead] in "]}":
                index += 1
                continue
        output.append(char)
        index += 1
    return "".join(output)


def parse_jsonc(text: str) -> Any:
    return json.loads(_strip_trailing_commas(_strip_json_comments(text)))


def read_vscode_settings(vscode_user_dir: Path) -> Dict[str, Any]:
    settings_path = vscode_user_dir / "settings.json"
    if not settings_path.is_file():
        raise FileNotFoundError(f"未找到 VS Code 用户设置：{settings_path}")
    value = parse_jsonc(settings_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("VS Code 用户设置不是 JSON 对象。")
    return value


def read_vscode_extension_state(vscode_user_dir: Path) -> Dict[str, Any]:
    database_path = vscode_user_dir / "globalStorage" / "state.vscdb"
    if not database_path.is_file():
        raise FileNotFoundError(f"未找到 VS Code globalState 数据库：{database_path}")
    uri = f"{database_path.as_uri()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        row = connection.execute(
            "SELECT value FROM ItemTable WHERE key = ?",
            (VSCODE_EXTENSION_STATE_KEY,),
        ).fetchone()
    if not row:
        return {}
    raw = row[0]
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    value = json.loads(raw)
    return value if isinstance(value, dict) else {}


def build_import_state(
    settings: Dict[str, Any],
    extension_state: Dict[str, Any],
) -> Dict[str, Any]:
    stocks = settings.get("leek-fund.stocks", [])
    raw_groups = settings.get("leek-fund.stockGroups", [])
    groups: List[Dict[str, Any]] = []
    if isinstance(raw_groups, list):
        for group in raw_groups:
            if not isinstance(group, dict):
                continue
            category = CATEGORY_MAP.get(group.get("category"))
            if not category:
                continue
            imported_group = {
                "id": group.get("id"),
                "name": group.get("name"),
                "category": category,
                "stock_codes": group.get("stockCodes", []),
            }
            parent_id = str(group.get("parentId") or "").strip()
            if parent_id:
                imported_group["parent_id"] = parent_id
            groups.append(imported_group)

    return plugin_api.normalize_state(
        {
            "stocks": stocks if isinstance(stocks, list) else [],
            "groups": groups,
            "holding_codes": extension_state.get(
                "leek-fund.stockTreeHoldingCodes", []
            ),
            "watch_codes": extension_state.get(
                "leek-fund.stockTreeWatchCodes", []
            ),
            "status_bar_stock_codes": settings.get(
                "leek-fund.statusBarStock", []
            ),
        }
    )


def summarize_state(state: Dict[str, Any]) -> Dict[str, int]:
    return {
        "stocks": len(state["stocks"]),
        "groups": len(state["groups"]),
        "child_groups": sum(
            1 for group in state["groups"] if group.get("parent_id")
        ),
        "holding_codes": len(state["holding_codes"]),
        "watch_codes": len(state["watch_codes"]),
        "status_bar_stock_codes": len(state["status_bar_stock_codes"]),
    }


def target_state_path(hermes_home: Path) -> Path:
    return hermes_home / "plugins" / plugin_api.PLUGIN_ID / "data" / "state.json"


def write_import_state(
    state: Dict[str, Any],
    hermes_home: Path,
) -> tuple[Dict[str, Any], Optional[Path]]:
    normalized = plugin_api.normalize_state(state)
    target = target_state_path(hermes_home)
    target.parent.mkdir(parents=True, exist_ok=True)
    backup: Optional[Path] = None
    if target.is_file():
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        backup = target.with_name(f"state.before-vscode-sync-{timestamp}.json")
        shutil.copy2(target, backup)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    temporary.replace(target)
    return normalized, backup


def default_vscode_user_dir() -> Path:
    return Path.home() / "Library" / "Application Support" / "Code" / "User"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="将 VS Code LeekFund 股票树数据一次性同步到 Hermes。"
    )
    parser.add_argument(
        "--vscode-user-dir",
        type=Path,
        default=default_vscode_user_dir(),
        help="VS Code User 目录。",
    )
    parser.add_argument(
        "--hermes-home",
        type=Path,
        default=Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes"),
        help="目标 Hermes Home。",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="执行写入；不传时只输出同步预览。",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    vscode_user_dir = args.vscode_user_dir.expanduser().resolve()
    hermes_home = args.hermes_home.expanduser().resolve()
    settings = read_vscode_settings(vscode_user_dir)
    extension_state = read_vscode_extension_state(vscode_user_dir)
    state = build_import_state(settings, extension_state)
    result: Dict[str, Any] = {
        "mode": "apply" if args.apply else "preview",
        "target": str(target_state_path(hermes_home)),
        "summary": summarize_state(state),
    }
    if args.apply:
        saved, backup = write_import_state(state, hermes_home)
        result["summary"] = summarize_state(saved)
        result["backup"] = str(backup) if backup else None
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
