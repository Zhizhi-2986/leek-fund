from __future__ import annotations

import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib import parse as urllib_parse


MODULE_PATH = Path(__file__).resolve().parents[2] / "dashboard" / "plugin_api.py"
DESKTOP_PLUGIN_PATH = Path(__file__).resolve().parents[2] / "desktop" / "plugin.js"
SPEC = importlib.util.spec_from_file_location("leek_fund_plugin_api", MODULE_PATH)
assert SPEC and SPEC.loader
plugin_api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(plugin_api)

SYNC_SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "scripts" / "sync-vscode-data.py"
)
SYNC_SPEC = importlib.util.spec_from_file_location(
    "leek_fund_sync_vscode_data", SYNC_SCRIPT_PATH
)
assert SYNC_SPEC and SYNC_SPEC.loader
sync_vscode_data = importlib.util.module_from_spec(SYNC_SPEC)
SYNC_SPEC.loader.exec_module(sync_vscode_data)


class DesktopPluginStaticTest(unittest.TestCase):
    def test_snapshot_refresh_interval_is_two_seconds(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        start = source.index("function useSnapshot")
        end = source.index("\n\nfunction usePluginAction", start)
        snapshot_hook = source[start:end]

        self.assertIn("refetchInterval: 2000", snapshot_hook)
        self.assertIn("staleTime: 2000", snapshot_hook)

    def test_group_drop_reads_placement_before_async_action(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        start = source.index("  const dropOnGroup =")
        end = source.index("\n\n  return {", start)
        drop_handler = source[start:end]

        self.assertIn("const placement = dropPlacement(event)", drop_handler)
        self.assertIn(
            "api.reorderGroup(currentItem.id, group.id, placement)",
            drop_handler,
        )
        self.assertNotIn(
            "api.reorderGroup(currentItem.id, group.id, dropPlacement(event))",
            drop_handler,
        )

    def test_minute_stock_api_uses_private_rest_path(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("minuteStock: (code) =>", source)
        self.assertIn("/stock-minute?code=", source)

    def test_stock_minute_card_renders_svg_and_pre_close_line(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        start = source.index("function StockMinuteCard")
        end = source.index("function StockRow", start)
        card = source[start:end]

        self.assertIn("buildMinuteChart", card)
        self.assertIn("pointer-events-none fixed z-50", card)
        self.assertIn("strokeDasharray: '4 3'", card)
        self.assertIn("昨收", card)
        self.assertIn("分时数据加载失败", card)
        self.assertIn("avgLine", card)
        self.assertIn("涨停", card)
        self.assertIn("跌停", card)
        self.assertIn("均价", card)

    def test_minute_card_uses_tencent_limit_field_indices(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("limit_up", source)
        self.assertIn("limit_down", source)
        self.assertIn("data?.limit_up", source)
        self.assertIn("data?.limit_down", source)
        self.assertIn("fmtLimit(limitUp)", source)
        self.assertIn("fmtLimit(limitDown)", source)
        self.assertIn("涨停 ${fmtLimit(limitUp)}", source)
        self.assertIn("跌停 ${fmtLimit(limitDown)}", source)

    def test_minute_card_renders_moving_averages_and_opaque_background(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("MA5", source)
        self.assertIn("MA10", source)
        self.assertIn("MA20", source)
        self.assertIn("data.ma5", source)
        self.assertIn("data.ma10", source)
        self.assertIn("data.ma20", source)
        self.assertIn("bg-(--ui-bg-elevated)", source)
        self.assertNotIn("最新 ${latest.time}", source)

    def test_speed_ranking_pane_has_add_to_watch_button(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("fullCode", source)
        self.assertIn("onAdd", source)
        self.assertIn("item.added", source)
        self.assertIn("currentApi.addStock(fullCode(item.code))", source)
        self.assertIn("[ID, 'speed-ranking']", source)

    def test_move_dialog_uses_watch_instead_of_ungrouped(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("selectGroup('watch', t('watch'))", source)
        self.assertNotIn("selectGroup('ungrouped'", source)
        self.assertNotIn("ungrouped", source)

    def test_stock_hover_limited_to_a_share_and_closes_on_scroll(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("/^(sh|sz|bj)/.test(String(stock.code", source)
        self.assertIn("onMouseEnter: handleMouseEnter", source)
        self.assertIn("onMouseLeave: handleMouseLeave", source)
        self.assertIn("onWheel: () => setHover(null)", source)

    def test_speed_ranking_uses_private_rest_and_two_second_refresh(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("ranking: (type) =>", source)
        self.assertIn("request(`/speed-ranking?type=", source)
        start = source.index("function useRanking")
        end = source.index("\n\nfunction usePluginAction", start)
        ranking_hook = source[start:end]

        self.assertIn("refetchInterval: 2000", ranking_hook)
        self.assertIn("staleTime: 2000", ranking_hook)

    def test_speed_ranking_pane_only_renders_requested_quote_fields(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        start = source.index("function SpeedRankingPane")
        end = source.index("\n\nfunction StatusTicker", start)
        pane = source[start:end]

        self.assertIn("children: item.name", pane)
        self.assertIn("children: item.code", pane)
        self.assertIn("children: item.price", pane)
        self.assertIn("children: `${item.percent}%`", pane)
        self.assertNotIn("item.speed", pane)

    def test_speed_ranking_pane_has_four_tabs(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("RANKING_TABS", source)
        self.assertIn("{ id: 'speed'", source)
        self.assertIn("{ id: 'up'", source)
        self.assertIn("{ id: 'down'", source)
        self.assertIn("{ id: 'strategy'", source)
        self.assertIn("rankingTitle", source)
        self.assertIn("upRanking", source)
        self.assertIn("downRanking", source)
        self.assertIn("strategyEmpty", source)
        self.assertIn("useRanking(api, isStrategy ? null : tab)", source)
        self.assertIn("useStrategies(api, isStrategy)", source)
        self.assertIn("api.strategies", source)

    def test_speed_ranking_added_shows_group_name_not_check(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("item.group_id", source)
        self.assertIn("item.group_name", source)
        self.assertIn("item.group_id === 'watch'", source)
        self.assertIn("t('holding')", source)
        self.assertNotIn("name: item.added ? 'check'", source)

    def test_speed_ranking_rows_show_minute_card_on_hover(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        start = source.index("function SpeedRankingPane")
        end = source.index("\n\nfunction StatusTicker", start)
        pane = source[start:end]

        self.assertIn("minuteQuery", pane)
        self.assertIn("api.minuteStock(hover.code)", pane)
        self.assertIn("onRowEnter", pane)
        self.assertIn("onMouseEnter: (event) => onRowEnter(event, item)", pane)
        self.assertIn("onMouseLeave: onRowLeave", pane)
        self.assertIn("onWheel: () => setHover(null)", pane)
        self.assertIn("jsx(StockMinuteCard", pane)

    def test_stock_tree_fold_state_is_persisted(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("storage.get('stockTree.marketState'", source)
        self.assertIn("storage.get('stockTree.groupState'", source)
        self.assertIn("storage.set('stockTree.marketState'", source)
        self.assertIn("storage.set('stockTree.groupState'", source)
        self.assertIn("storage: ctx.storage", source)

    def test_leaf_group_shows_avg_percent_not_count(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("groupAvgPercent", source)
        self.assertIn("!childGroups.length", source)
        self.assertIn("avg.toFixed(2)", source)
        self.assertNotIn("group.count ?? group.stocks.length", source)

    def test_stock_pane_has_collapse_all_button(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("collapseAll", source)
        self.assertIn("name: 'collapse-all'", source)
        self.assertIn("onClick: collapseAll", source)

    def test_minute_card_shows_high_and_low_without_rounding(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("最高 ${highText}", source)
        self.assertIn("最低 ${lowText}", source)
        self.assertIn("data?.high || '--'", source)
        self.assertIn("data?.low || '--'", source)
        self.assertIn("pctOf(highValue)", source)
        self.assertIn("pctOf(lowValue)", source)

    def test_minute_card_layout_dynamic_axis_and_pre_close_label(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn(
            "buildMinuteChart(data.points, 190, 116, data.pre_close)",
            source,
        )
        self.assertNotIn("hasBounds", source)
        self.assertIn("昨收 ${data.pre_close || '--'}", source)
        self.assertIn("data?.price || '--'", source)
        self.assertIn("MA5 ${fmtMA(data.ma5)}", source)
        self.assertIn("均价 ${avgText}", source)
        self.assertIn("涨停 ${fmtLimit(limitUp)}", source)
        self.assertIn("跌停 ${fmtLimit(limitDown)}", source)

    def test_status_ticker_shows_minute_on_hover(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        start = source.index("function StatusTicker")
        end = source.index("\n\nexport default", start)
        ticker = source[start:end]

        self.assertIn("minuteQuery", ticker)
        self.assertIn("api.minuteStock(hover.code)", ticker)
        self.assertIn("canShowMinute", ticker)
        self.assertIn("/^(sh|sz)/.test(String(item.code", ticker)
        self.assertIn("jsx(StockMinuteCard", ticker)

    def test_watch_group_hides_delete_menu_item(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("...(groupId === 'watch'", source)
        self.assertIn("api.deleteStock(stock.code)", source)

    def test_speed_ranking_registers_independent_left_pane(self) -> None:
        source = DESKTOP_PLUGIN_PATH.read_text(encoding="utf-8")
        self.assertIn("id: 'speed-ranking-sidebar'", source)
        self.assertIn("title: '行情排行'", source)
        self.assertIn("dock: { pane: 'stock-tree-sidebar', pos: 'bottom' }", source)
        self.assertIn("height: '40vh'", source)
        self.assertIn("minHeight: '12rem'", source)
        self.assertIn("render: () => jsx(SpeedRankingPane, { api })", source)


class PluginApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.hermes_home = Path(self.temp_dir.name)
        self.home_patch = mock.patch.object(
            plugin_api, "get_hermes_home", return_value=self.hermes_home
        )
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)
        self.addCleanup(plugin_api.MINUTE_CACHE.clear)
        self.addCleanup(plugin_api.SPEED_RANKING_CACHE.clear)

    def test_state_normalization_rejects_invalid_codes(self) -> None:
        state = plugin_api.normalize_state(
            {
                "stocks": ["SH600000", "hk00700", "bad-code", "SH600000"],
                "holding_codes": ["sh600000", "bad-code"],
                "watch_codes": ["hk00700"],
            }
        )

        self.assertEqual(state["stocks"], ["sh600000", "hk00700"])
        self.assertEqual(state["holding_codes"], ["sh600000"])
        self.assertEqual(state["watch_codes"], ["hk00700"])

    def test_group_delete_keeps_stock_and_overlay_flags(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000"],
                "groups": [
                    {
                        "id": "group-1",
                        "name": "核心",
                        "category": "A",
                        "stock_codes": ["sh600000"],
                    }
                ],
                "holding_codes": ["sh600000"],
                "watch_codes": ["sh600000"],
                "status_bar_stock_codes": [],
            }
        )

        plugin_api.delete_group("group-1")
        state = plugin_api.load_state()

        self.assertEqual(state["stocks"], ["sh600000"])
        self.assertEqual(state["groups"], [])
        self.assertEqual(state["holding_codes"], ["sh600000"])
        self.assertEqual(state["watch_codes"], ["sh600000"])

    def test_snapshot_has_fixed_group_order_and_overlay_stock(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000"],
                "groups": [
                    {
                        "id": "group-1",
                        "name": "核心",
                        "category": "A",
                        "stock_codes": ["sh600000"],
                    }
                ],
                "holding_codes": ["sh600000"],
                "watch_codes": ["sh600000"],
                "status_bar_stock_codes": ["sh600000"],
            }
        )
        quotes = {
            "sh600000": {
                "code": "sh600000",
                "name": "浦发银行",
                "price": "10.00",
                "percent": "+1.00",
                "available": True,
            },
            "sh000001": {
                "code": "sh000001",
                "name": "上证指数",
                "price": "3000.00",
                "percent": "+0.50",
                "available": True,
            },
        }

        with mock.patch.object(
            plugin_api,
            "refresh_quotes",
            return_value=(
                quotes,
                {"stale": False, "errors": [], "updated_at": 100},
            ),
        ):
            snapshot = plugin_api.build_snapshot()

        a_stock = snapshot["categories"][0]
        self.assertEqual(
            [group["id"] for group in a_stock["groups"]],
            ["holding", "watch", "group-1"],
        )
        self.assertEqual(a_stock["groups"][0]["stocks"][0]["code"], "sh600000")
        self.assertEqual(a_stock["groups"][1]["stocks"][0]["code"], "sh600000")
        self.assertEqual(a_stock["groups"][2]["stocks"][0]["code"], "sh600000")
        self.assertEqual(snapshot["status_bar"][-1]["code"], "sh600000")

    def test_snapshot_only_exposes_a_share_tree_and_status_stocks(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000", "hk00700", "usr_aapl"],
                "status_bar_stock_codes": ["sh600000", "hk00700", "usr_aapl"],
            }
        )

        with mock.patch.object(
            plugin_api,
            "refresh_quotes",
            return_value=(
                {},
                {"stale": False, "errors": [], "updated_at": 100},
            ),
        ):
            snapshot = plugin_api.build_snapshot()

        self.assertEqual(
            [category["id"] for category in snapshot["categories"]],
            ["A"],
        )
        self.assertEqual(
            plugin_api.load_state()["stocks"],
            [
                "sh600000",
                "hk00700",
                "usr_aapl",
            ],
        )
        self.assertEqual(
            [item["code"] for item in snapshot["status_bar"]],
            plugin_api.DEFAULT_INDEX_CODES + ["sh600000"],
        )

    def test_etf_price_uses_three_decimal_truncation(self) -> None:
        cases = [
            ("sh512880", "证券ETF国泰", "1.1269", "1.126"),
            ("sh588990", "科创芯片ETF博时", "3.4499", "3.449"),
            ("sz159272", "机器人FG", "0.7549", "0.754"),
            ("sz159381", "创AI", "1.12", "1.120"),
            ("sh500001", "测试ETF", "1.9999", "1.999"),
            ("sh580001", "测试权证", "1.9999", "2.00"),
            ("sh600000", "浦发银行", "10.129", "10.13"),
        ]

        for code, name, price, expected in cases:
            with self.subTest(code=code, name=name):
                quote = plugin_api._quote(code, name, price, "1.00")
                self.assertIsNotNone(quote)
                assert quote
                self.assertEqual(quote["price"], expected)

        stale_etf = plugin_api._stock_view(
            "sh512880",
            {
                "sh512880": {
                    "code": "sh512880",
                    "name": "证券ETF国泰",
                    "price": "1.12",
                    "available": True,
                }
            },
            plugin_api.default_state(),
        )
        self.assertEqual(stale_etf["price"], "1.120")

    def test_tencent_stock_search_only_returns_a_shares(self) -> None:
        payload = {
            "data": {
                "stock": [
                    ["sh", "600000", "浦发银行", "PFYH"],
                    ["hk", "00700", "腾讯控股", "TXKG"],
                    ["us", "AAPL", "苹果", "PG"],
                    ["sz", "000001", "平安银行", "PAYH"],
                    ["sh", "600000", "浦发银行", "PFYH"],
                ]
            }
        }

        with mock.patch.object(
            plugin_api,
            "_http_get",
            return_value=json.dumps(payload).encode("utf-8"),
        ) as http_get:
            result = plugin_api.search_a_stocks("浦发")

        self.assertEqual(
            result,
            [
                {"code": "sh600000", "name": "浦发银行"},
                {"code": "sz000001", "name": "平安银行"},
            ],
        )
        requested_url = http_get.call_args.args[0]
        self.assertIn("q=%E6%B5%A6%E5%8F%91", requested_url)

    def test_speed_ranking_parses_sorts_and_limits_a_shares(self) -> None:
        rows = [
            {
                "f12": f"600{index:03d}",
                "f14": f"股票{index}",
                "f2": 10 + index / 100,
                "f3": index / 10,
                "f22": index / 100,
            }
            for index in range(22)
        ]
        rows.extend(
            [
                {"f12": "00700", "f14": "港股", "f2": 1, "f3": 1, "f22": 99},
                {"f12": "600999", "f14": "", "f2": 1, "f3": 1, "f22": 98},
                {"f12": "600998", "f14": "无价格", "f2": "-", "f3": 1, "f22": 97},
            ]
        )

        result = plugin_api.parse_speed_ranking({"data": {"diff": rows}})

        self.assertEqual(len(result), 20)
        self.assertEqual(result[0]["code"], "600021")
        self.assertEqual(result[-1]["code"], "600002")
        self.assertEqual(
            set(result[0]),
            {"code", "name", "price", "percent", "speed"},
        )
        self.assertEqual(result[0]["price"], "10.21")
        self.assertEqual(result[0]["percent"], "+2.10")
        self.assertGreater(result[0]["speed"], result[-1]["speed"])

    def test_speed_ranking_request_targets_all_a_share_markets(self) -> None:
        payload = {
            "data": {
                "diff": [
                    {
                        "f12": "600000",
                        "f14": "浦发银行",
                        "f2": 10.0,
                        "f3": 1.2,
                        "f22": 0.5,
                    }
                ]
            }
        }
        with mock.patch.object(
            plugin_api,
            "fetch_tencent_speed_ranking",
            side_effect=RuntimeError("tencent down"),
        ):
            with mock.patch.object(
                plugin_api,
                "_http_get",
                return_value=json.dumps(payload).encode("utf-8"),
            ) as http_get:
                result = plugin_api.fetch_ranking()

        request_url = urllib_parse.urlsplit(http_get.call_args.args[0])
        query = urllib_parse.parse_qs(request_url.query)
        self.assertEqual(request_url.scheme, "http")
        self.assertEqual(query["fs"], [plugin_api.EASTMONEY_A_SHARE_FILTER])
        self.assertIn("m:0+t:81+s:2048", query["fs"][0])
        self.assertEqual(query["fid"], ["f22"])
        self.assertEqual(query["pz"], ["20"])
        self.assertEqual(result[0]["code"], "600000")

    def test_speed_ranking_excludes_st_and_beijing_exchange_stocks(self) -> None:
        result = plugin_api.parse_speed_ranking(
            {
                "data": {
                    "diff": [
                        {
                            "f12": "920357",
                            "f14": "雅葆轩",
                            "f2": 34.0,
                            "f3": 2.0,
                            "f22": 1.6,
                        },
                        {
                            "f12": "430047",
                            "f14": "诺思兰德",
                            "f2": 12.0,
                            "f3": 3.0,
                            "f22": 1.5,
                        },
                        {
                            "f12": "600381",
                            "f14": "ST春天",
                            "f2": 8.0,
                            "f3": 5.0,
                            "f22": 1.4,
                        },
                        {
                            "f12": "002086",
                            "f14": "*ST东洋",
                            "f2": 6.0,
                            "f3": 4.0,
                            "f22": 1.3,
                        },
                        {
                            "f12": "300001",
                            "f14": "特锐德",
                            "f2": 20.0,
                            "f3": 1.0,
                            "f22": 1.2,
                        },
                    ]
                }
            }
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["code"], "300001")
        self.assertEqual(result[0]["name"], "特锐德")

    def test_speed_ranking_falls_back_to_delay_node(self) -> None:
        payload = json.dumps(
            {
                "data": {
                    "diff": [
                        {
                            "f12": "600000",
                            "f14": "浦发银行",
                            "f2": 10.0,
                            "f3": 1.2,
                            "f22": 0.5,
                        }
                    ]
                }
            }
        ).encode("utf-8")
        with mock.patch.object(
            plugin_api,
            "fetch_tencent_speed_ranking",
            side_effect=RuntimeError("tencent down"),
        ):
            with mock.patch.object(
                plugin_api,
                "_http_get",
                side_effect=[RuntimeError("offline"), payload],
            ) as http_get:
                result = plugin_api.fetch_ranking()

        self.assertEqual(result[0]["code"], "600000")
        self.assertEqual(http_get.call_count, 2)
        fallback_url = http_get.call_args.args[0]
        self.assertIn("push2delay.eastmoney.com", fallback_url)

    def test_speed_ranking_raises_when_all_sources_fail(self) -> None:
        with mock.patch.object(
            plugin_api,
            "_http_get",
            side_effect=RuntimeError("offline"),
        ):
            with self.assertRaises(RuntimeError) as raised:
                plugin_api.fetch_ranking()
        self.assertIn("榜单所有行情源均不可用", str(raised.exception))

    def test_ranking_up_and_down_sort_by_percent(self) -> None:
        rows = [
            {"f12": f"600{index:03d}", "f14": f"股票{index}", "f2": 10.0, "f3": pct, "f22": 0.1}
            for index, pct in enumerate([-3.0, 1.0, 5.0, -1.0])
        ]
        up = plugin_api.parse_speed_ranking(
            {"data": {"diff": rows}}, rank_type="up"
        )
        down = plugin_api.parse_speed_ranking(
            {"data": {"diff": rows}}, rank_type="down"
        )
        self.assertEqual(
            [item["percent"] for item in up],
            ["+5.00", "+1.00", "-1.00", "-3.00"],
        )
        self.assertEqual(
            [item["percent"] for item in down],
            ["-3.00", "-1.00", "+1.00", "+5.00"],
        )

    def test_ma_bullish_detects_alignment(self) -> None:
        rising = [10 + i * 0.1 for i in range(60)]
        self.assertTrue(plugin_api._ma_bullish([], rising))
        falling = [10 - i * 0.1 for i in range(60)]
        self.assertFalse(plugin_api._ma_bullish([], falling))

    def test_breakout_detects_new_high_with_volume(self) -> None:
        rows = []
        for i in range(60):
            high = 10 + i * 0.02
            rows.append(
                ["2026-01-01", "10", str(high - 0.2), str(high), "9.8", "1000"]
            )
        rows[-1] = ["2026-01-02", "10", "12.0", "12.5", "9.8", "5000"]
        self.assertTrue(plugin_api._breakout(rows, []))

        no_volume = list(rows)
        no_volume[-1] = ["2026-01-02", "10", "12.0", "12.5", "9.8", "1000"]
        self.assertFalse(plugin_api._breakout(no_volume, []))

    def test_macd_golden_cross_returns_bool(self) -> None:
        rising = [10 + i * 0.1 for i in range(60)]
        self.assertIsInstance(plugin_api._macd_golden_cross([], rising), bool)
        falling = [10 - i * 0.1 for i in range(60)]
        self.assertFalse(plugin_api._macd_golden_cross([], falling))

    def test_get_strategies_returns_groups_and_added(self) -> None:
        plugin_api.save_state({"stocks": ["sh600000"], "watch_codes": ["sh600000"]})
        items = [
            {
                "code": "600000",
                "name": "浦发",
                "price": "10.00",
                "percent": "+10.00",
                "speed": 0,
            }
        ]

        def fake_apply(candidates, matcher, limit=8):
            return items

        with mock.patch.object(
            plugin_api,
            "_strategy_candidates",
            return_value=items,
        ):
            with mock.patch.object(
                plugin_api,
                "_apply_strategy",
                side_effect=fake_apply,
            ):
                result = plugin_api.get_strategies()

        groups = {group["id"]: group for group in result["groups"]}
        self.assertEqual(len(groups["macd-cross"]["items"]), 1)
        self.assertTrue(groups["macd-cross"]["items"][0]["added"])
        self.assertEqual(groups["macd-cross"]["items"][0]["group_id"], "watch")
        self.assertEqual(result["success"], True)

    def test_tencent_speed_ranking_parses_and_sorts(self) -> None:
        payload = json.dumps(
            {
                "data": {
                    "rank_list": [
                        {
                            "code": "sz300540",
                            "name": "蜀道装备",
                            "zxj": "35.54",
                            "zdf": "5.74",
                            "speed": "5.77",
                        },
                        {
                            "code": "bj920357",
                            "name": "雅葆轩",
                            "zxj": "34.0",
                            "zdf": "2.0",
                            "speed": "1.6",
                        },
                        {
                            "code": "sh600381",
                            "name": "ST春天",
                            "zxj": "8.0",
                            "zdf": "5.0",
                            "speed": "1.4",
                        },
                    ]
                }
            }
        ).encode("utf-8")
        with mock.patch.object(
            plugin_api,
            "_http_get",
            return_value=payload,
        ) as http_get:
            result = plugin_api.fetch_tencent_speed_ranking()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["code"], "300540")
        request_url = urllib_parse.urlsplit(http_get.call_args.args[0])
        query = urllib_parse.parse_qs(request_url.query)
        self.assertEqual(query["sort_type"], ["speed"])
        self.assertEqual(query["direct"], ["down"])

    def test_sina_ranking_requests_up_and_down_order(self) -> None:
        payload = json.dumps(
            [
                {
                    "symbol": "sz000001",
                    "code": "000001",
                    "name": "平安银行",
                    "trade": "10.00",
                    "changepercent": 1.2,
                }
            ]
        ).encode("utf-8")
        with mock.patch.object(
            plugin_api,
            "_http_get",
            return_value=payload,
        ) as http_get:
            plugin_api.fetch_sina_ranking("down")

        request_url = urllib_parse.urlsplit(http_get.call_args.args[0])
        query = urllib_parse.parse_qs(request_url.query)
        self.assertEqual(query["sort"], ["changepercent"])
        self.assertEqual(query["asc"], ["1"])
        self.assertEqual(query["node"], ["hs_a"])

    def test_speed_ranking_marks_added_for_existing_stocks(self) -> None:
        plugin_api.save_state({"stocks": ["sh600000"], "watch_codes": ["sh600000"]})
        items = [
            {
                "code": "600000",
                "name": "浦发银行",
                "price": "10.00",
                "percent": "+1.20",
                "speed": 0.5,
            },
            {
                "code": "300001",
                "name": "特锐德",
                "price": "20.00",
                "percent": "+1.00",
                "speed": 0.4,
            },
        ]
        with mock.patch.object(
            plugin_api,
            "fetch_ranking",
            return_value=items,
        ):
            result = plugin_api.get_ranking()

        by_code = {item["code"]: item for item in result["items"]}
        self.assertTrue(by_code["600000"]["added"])
        self.assertEqual(by_code["600000"]["group_id"], "watch")
        self.assertFalse(by_code["300001"]["added"])
        self.assertEqual(by_code["300001"]["group_id"], "")

    def test_stock_group_label_uses_deepest_group(self) -> None:
        state = plugin_api.normalize_state(
            {
                "stocks": ["sh600000", "sz000001", "sz300001"],
                "groups": [
                    {
                        "id": "root",
                        "name": "核心",
                        "category": "A",
                        "stock_codes": [],
                    },
                    {
                        "id": "child",
                        "name": "银行",
                        "category": "A",
                        "parent_id": "root",
                        "stock_codes": ["sh600000"],
                    },
                    {
                        "id": "other",
                        "name": "科技",
                        "category": "A",
                        "stock_codes": ["sz000001"],
                    },
                ],
                "watch_codes": ["sz300001"],
            }
        )

        group_id, group_name = plugin_api._stock_group_label(
            state, "sh600000", "A"
        )
        self.assertEqual((group_id, group_name), ("child", "银行"))
        group_id, group_name = plugin_api._stock_group_label(
            state, "sz000001", "A"
        )
        self.assertEqual((group_id, group_name), ("other", "科技"))
        group_id, group_name = plugin_api._stock_group_label(
            state, "sz300001", "A"
        )
        self.assertEqual((group_id, group_name), ("watch", ""))

    def test_moving_average_requires_enough_valid_closes(self) -> None:
        closes = [9.9, 9.85, 9.9, 9.6, 9.7, 9.5, 9.6, 9.4, 9.2, 9.1]
        self.assertEqual(plugin_api._moving_average(closes, 5), 9.36)
        self.assertEqual(plugin_api._moving_average(closes, 10), 9.575)
        self.assertEqual(plugin_api._moving_average(closes, 20), 0.0)
        self.assertEqual(
            plugin_api._moving_average([0.0, 9.5, 9.5, 9.5, 9.5], 5), 0.0
        )

    def test_speed_ranking_uses_two_second_cache(self) -> None:
        items = [
            {
                "code": "600000",
                "name": "浦发银行",
                "price": "10.00",
                "percent": "+1.20",
                "speed": 0.5,
            }
        ]
        with mock.patch.object(
            plugin_api,
            "fetch_ranking",
            return_value=items,
        ) as fetch_mock:
            first = plugin_api.get_ranking()
            second = plugin_api.get_ranking()

        self.assertEqual(first, second)
        self.assertEqual(fetch_mock.call_count, 1)

    def test_speed_ranking_returns_502_on_upstream_failure(self) -> None:
        with mock.patch.object(
            plugin_api,
            "fetch_ranking",
            side_effect=RuntimeError("offline"),
        ):
            with self.assertRaises(plugin_api.HTTPException) as raised:
                plugin_api.speed_ranking()

        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("行情排行请求失败", raised.exception.detail)

    def test_refresh_failure_preserves_cached_quotes(self) -> None:
        plugin_api._write_json_atomic(
            plugin_api.market_cache_path(),
            {
                "updated_at": 100,
                "quotes": {
                    "sh600000": {
                        "code": "sh600000",
                        "name": "浦发银行",
                        "price": "10.00",
                        "percent": "+1.00",
                        "available": True,
                    }
                },
            },
        )
        state = plugin_api.normalize_state({"stocks": ["sh600000"]})

        with (
            mock.patch.object(
                plugin_api, "fetch_sina_quotes", side_effect=RuntimeError("offline")
            ),
            mock.patch.object(
                plugin_api,
                "fetch_hk_quotes",
                return_value={},
            ) as fetch_hk_quotes,
        ):
            quotes, status = plugin_api.refresh_quotes(state)

        self.assertEqual(quotes["sh600000"]["price"], "10.00")
        self.assertTrue(status["stale"])
        self.assertEqual(status["updated_at"], 100)
        fetch_hk_quotes.assert_not_called()

    def test_move_stock_rejects_cross_market_group(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000", "hk00700"],
                "groups": [
                    {
                        "id": "hk-group",
                        "name": "港股",
                        "category": "HK",
                        "stock_codes": [],
                    }
                ],
            }
        )

        with self.assertRaises(plugin_api.HTTPException) as raised:
            plugin_api.move_stock("sh600000", {"group_id": "hk-group"})

        self.assertEqual(raised.exception.status_code, 400)

    def test_reorder_stock_within_and_across_groups_preserves_flags(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000", "sh600001", "sh600002"],
                "groups": [
                    {
                        "id": "group-1",
                        "name": "一组",
                        "category": "A",
                        "stock_codes": ["sh600000", "sh600001"],
                    },
                    {
                        "id": "group-2",
                        "name": "二组",
                        "category": "A",
                        "stock_codes": ["sh600002"],
                    },
                ],
                "holding_codes": ["sh600000"],
                "watch_codes": ["sh600000"],
                "status_bar_stock_codes": ["sh600000"],
            }
        )

        plugin_api.reorder_stock(
            "sh600001",
            {
                "target_group_id": "group-1",
                "target_code": "sh600000",
                "placement": "before",
            },
        )
        state = plugin_api.load_state()
        self.assertEqual(
            state["groups"][0]["stock_codes"],
            ["sh600001", "sh600000"],
        )

        plugin_api.reorder_stock(
            "sh600000",
            {
                "target_group_id": "group-2",
                "target_code": "sh600002",
                "placement": "after",
            },
        )
        state = plugin_api.load_state()
        self.assertEqual(state["groups"][0]["stock_codes"], ["sh600001"])
        self.assertEqual(
            state["groups"][1]["stock_codes"],
            ["sh600002", "sh600000"],
        )
        self.assertEqual(state["holding_codes"], ["sh600000"])
        self.assertEqual(state["watch_codes"], ["sh600000"])
        self.assertEqual(state["status_bar_stock_codes"], ["sh600000"])

    def test_reorder_holding_and_watch_are_independent_overlays(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000", "sh600001", "sh600002"],
                "groups": [
                    {
                        "id": "group-1",
                        "name": "一组",
                        "category": "A",
                        "stock_codes": [
                            "sh600000",
                            "sh600001",
                            "sh600002",
                        ],
                    }
                ],
                "holding_codes": ["sh600000", "sh600001"],
                "watch_codes": ["sh600001", "sh600002"],
                "status_bar_stock_codes": ["sh600000"],
            }
        )

        plugin_api.reorder_stock(
            "sh600001",
            {
                "target_group_id": "holding",
                "target_code": "sh600000",
                "placement": "before",
            },
        )
        state = plugin_api.load_state()
        self.assertEqual(state["holding_codes"], ["sh600001", "sh600000"])
        self.assertEqual(state["watch_codes"], ["sh600001", "sh600002"])
        self.assertEqual(
            state["groups"][0]["stock_codes"],
            ["sh600000", "sh600001", "sh600002"],
        )
        self.assertEqual(state["status_bar_stock_codes"], ["sh600000"])

        plugin_api.reorder_stock(
            "sh600002",
            {
                "target_group_id": "watch",
                "target_code": "sh600001",
                "placement": "before",
            },
        )
        state = plugin_api.load_state()
        self.assertEqual(state["holding_codes"], ["sh600001", "sh600000"])
        self.assertEqual(state["watch_codes"], ["sh600002", "sh600001"])
        self.assertEqual(state["stocks"], ["sh600000", "sh600001", "sh600002"])
        groups = {
            group["id"]: group
            for group in plugin_api.build_categories(state, {})[0]["groups"]
        }
        self.assertEqual(
            [stock["code"] for stock in groups["holding"]["stocks"]],
            ["sh600001", "sh600000"],
        )
        self.assertEqual(
            [stock["code"] for stock in groups["watch"]["stocks"]],
            ["sh600002", "sh600001"],
        )

        with self.assertRaises(plugin_api.HTTPException) as raised:
            plugin_api.reorder_stock(
                "sh600002",
                {
                    "target_group_id": "holding",
                    "target_code": "sh600000",
                    "placement": "after",
                },
            )
        self.assertEqual(raised.exception.status_code, 400)

    def test_add_stock_defaults_to_watch_group(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000"],
                "groups": [],
                "watch_codes": [],
            }
        )

        plugin_api.add_stock({"code": "sz000001"})
        state = plugin_api.load_state()

        self.assertEqual(state["stocks"], ["sh600000", "sz000001"])
        self.assertIn("sz000001", state["watch_codes"])

    def test_move_stock_supports_watch_group(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000"],
                "groups": [
                    {
                        "id": "group-1",
                        "name": "一组",
                        "category": "A",
                        "stock_codes": ["sh600000"],
                    }
                ],
            }
        )

        plugin_api.move_stock("sh600000", {"group_id": "watch"})
        state = plugin_api.load_state()

        self.assertEqual(state["groups"][0]["stock_codes"], [])
        self.assertIn("sh600000", state["watch_codes"])

    def test_normalize_state_migrates_orphan_a_share_to_watch(self) -> None:
        state = plugin_api.normalize_state(
            {
                "stocks": ["sh600000", "sh600001", "hk00700"],
                "groups": [
                    {
                        "id": "group-1",
                        "name": "一组",
                        "category": "A",
                        "stock_codes": ["sh600001"],
                    }
                ],
                "watch_codes": [],
            }
        )

        self.assertIn("sh600000", state["watch_codes"])
        self.assertNotIn("sh600001", state["watch_codes"])
        self.assertNotIn("hk00700", state["watch_codes"])

    def test_reorder_groups_only_within_same_parent(self) -> None:
        plugin_api.save_state(
            {
                "stocks": [],
                "groups": [
                    {
                        "id": "root-a",
                        "name": "一级 A",
                        "category": "A",
                        "stock_codes": [],
                    },
                    {
                        "id": "child-a",
                        "name": "二级 A",
                        "category": "A",
                        "parent_id": "root-a",
                        "stock_codes": [],
                    },
                    {
                        "id": "child-b",
                        "name": "二级 B",
                        "category": "A",
                        "parent_id": "root-a",
                        "stock_codes": [],
                    },
                    {
                        "id": "root-b",
                        "name": "一级 B",
                        "category": "A",
                        "stock_codes": [],
                    },
                ],
            }
        )

        plugin_api.reorder_group(
            "root-b",
            {"target_group_id": "root-a", "placement": "before"},
        )
        plugin_api.reorder_group(
            "child-b",
            {"target_group_id": "child-a", "placement": "before"},
        )
        state = plugin_api.load_state()
        self.assertEqual(
            [group["id"] for group in state["groups"]],
            ["root-b", "root-a", "child-b", "child-a"],
        )

        with self.assertRaises(plugin_api.HTTPException) as raised:
            plugin_api.reorder_group(
                "root-b",
                {"target_group_id": "child-a", "placement": "after"},
            )
        self.assertEqual(raised.exception.status_code, 400)

    def test_nested_groups_are_preserved_in_snapshot(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000"],
                "groups": [
                    {
                        "id": "parent",
                        "name": "父分组",
                        "category": "A",
                        "stock_codes": [],
                    },
                    {
                        "id": "child",
                        "name": "子分组",
                        "category": "A",
                        "parent_id": "parent",
                        "stock_codes": ["sh600000"],
                    },
                ],
            }
        )
        quotes = {
            "sh600000": {
                "code": "sh600000",
                "name": "浦发银行",
                "price": "10.00",
                "percent": "+1.00",
                "available": True,
            }
        }

        categories = plugin_api.build_categories(plugin_api.load_state(), quotes)
        parent = categories[0]["groups"][2]

        self.assertEqual(parent["id"], "parent")
        self.assertEqual(parent["count"], 1)
        self.assertEqual(parent["children"][0]["id"], "child")
        self.assertEqual(
            parent["children"][0]["stocks"][0]["code"],
            "sh600000",
        )

    def test_delete_parent_group_deletes_children_but_keeps_stock(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000"],
                "groups": [
                    {
                        "id": "parent",
                        "name": "父分组",
                        "category": "A",
                        "stock_codes": [],
                    },
                    {
                        "id": "child",
                        "name": "子分组",
                        "category": "A",
                        "parent_id": "parent",
                        "stock_codes": ["sh600000"],
                    },
                ],
            }
        )

        plugin_api.delete_group("parent")
        state = plugin_api.load_state()

        self.assertEqual(state["stocks"], ["sh600000"])
        self.assertEqual(state["groups"], [])

    def test_tencent_minute_points_parses_rows(self) -> None:
        payload = json.dumps(
            {
                "code": 0,
                "data": {
                    "sh600000": {
                        "data": {
                            "data": [
                                "0930 9.90 100 9900.00",
                                "0931 0 0 0",
                                "0935 10.10 300 30300.00",
                                "bad-row",
                            ]
                        }
                    }
                },
            }
        ).encode("utf-8")

        with mock.patch.object(plugin_api, "_http_get", return_value=payload):
            points = plugin_api._tencent_minute_points("sh600000")

        self.assertEqual(len(points), 2)
        self.assertEqual(points[0]["time"], "09:30")
        self.assertEqual(points[0]["price"], 9.9)
        self.assertEqual(points[0]["volume"], 100)
        self.assertEqual(points[0]["amount"], 9900.0)
        self.assertEqual(points[1]["time"], "09:35")
        self.assertEqual(points[1]["price"], 10.1)

    def test_avg_price_handles_invalid_volume(self) -> None:
        self.assertIsNone(plugin_api._avg_price({"volume": 0, "amount": 9900.0}))
        self.assertIsNone(plugin_api._avg_price({"volume": 100, "amount": 0}))
        self.assertAlmostEqual(
            plugin_api._avg_price({"volume": 100, "amount": 99000.0}), 9.9
        )

    def test_get_a_minute_line_builds_quote_and_percent_change(self) -> None:
        minute_payload = json.dumps(
            {
                "data": {
                    "sh600000": {
                        "data": {
                            "data": [
                                "0930 9.90 100 99000.00",
                                "0931 9.95 250 248750.00",
                            ]
                        }
                    }
                }
            }
        ).encode("utf-8")
        quote_fields = ["0"] * 49
        quote_fields[1] = "浦发银行"
        quote_fields[3] = "9.95"
        quote_fields[4] = "9.90"
        quote_fields[5] = "9.90"
        quote_fields[33] = "10.00"
        quote_fields[34] = "9.80"
        quote_fields[47] = "10.89"
        quote_fields[48] = "8.91"
        quote_payload = f'v_sh600000="{"~".join(quote_fields)}~";'.encode("gbk")
        kline_payload = json.dumps(
            {
                "data": {
                    "sh600000": {
                        "qfqday": [
                            ["2026-07-10", "10.00", "9.90", "10.10", "9.80", "1"],
                            ["2026-07-11", "9.95", "9.85", "10.00", "9.70", "1"],
                            ["2026-07-14", "9.80", "9.90", "10.00", "9.60", "1"],
                            ["2026-07-15", "9.70", "9.60", "9.80", "9.50", "1"],
                            ["2026-07-16", "9.60", "9.70", "9.90", "9.40", "1"],
                            ["2026-07-17", "9.55", "9.50", "9.70", "9.30", "1"],
                            ["2026-07-18", "9.45", "9.60", "9.70", "9.20", "1"],
                            ["2026-07-21", "9.50", "9.40", "9.60", "9.10", "1"],
                            ["2026-07-22", "9.30", "9.20", "9.50", "9.00", "1"],
                            ["2026-07-23", "9.25", "9.10", "9.40", "8.90", "1"],
                            ["2026-07-24", "9.15", "9.30", "9.40", "9.00", "1"],
                            ["2026-07-25", "9.40", "9.50", "9.60", "9.20", "1"],
                            ["2026-07-28", "9.60", "9.55", "9.70", "9.30", "1"],
                            ["2026-07-29", "9.50", "9.45", "9.65", "9.25", "1"],
                            ["2026-07-30", "9.40", "9.35", "9.55", "9.15", "1"],
                            ["2026-07-31", "9.30", "9.25", "9.50", "9.10", "1"],
                            ["2026-08-03", "9.20", "9.30", "9.45", "9.05", "1"],
                            ["2026-08-04", "9.35", "9.40", "9.50", "9.20", "1"],
                            ["2026-08-05", "9.45", "9.30", "9.55", "9.10", "1"],
                        ]
                    }
                }
            }
        ).encode("utf-8")

        with mock.patch.object(
            plugin_api,
            "_http_get",
            side_effect=[minute_payload, quote_payload, kline_payload],
        ):
            result = plugin_api.get_a_minute_line("sh600000")

        self.assertEqual(result["code"], "sh600000")
        self.assertEqual(result["name"], "浦发银行")
        self.assertEqual(result["pre_close"], 9.9)
        self.assertEqual(result["price"], 9.95)
        self.assertEqual(result["high"], "10.00")
        self.assertEqual(result["low"], "9.80")
        self.assertEqual(result["limit_up"], 10.89)
        self.assertEqual(result["limit_down"], 8.91)
        self.assertEqual(len(result["points"]), 2)
        self.assertEqual(result["points"][0]["percent_change"], 0.0)
        self.assertAlmostEqual(
            result["points"][1]["percent_change"], (9.95 - 9.9) / 9.9 * 100
        )
        self.assertEqual(result["points"][1]["time"], "09:31")
        self.assertEqual(result["points"][0]["avg_price"], 9.9)
        self.assertEqual(result["points"][1]["avg_price"], 9.95)
        self.assertEqual(result["ma5"], 9.32)
        self.assertEqual(result["ma10"], 9.35)
        self.assertEqual(result["ma20"], 0.0)

    def test_get_a_minute_line_rejects_non_a_share(self) -> None:
        with self.assertRaises(plugin_api.HTTPException) as raised:
            plugin_api.get_a_minute_line("hk00700")
        self.assertEqual(raised.exception.status_code, 400)

        with self.assertRaises(plugin_api.HTTPException) as raised:
            plugin_api.get_a_minute_line("usr_aapl")
        self.assertEqual(raised.exception.status_code, 400)

    def test_get_a_minute_line_uses_ttl_cache(self) -> None:
        points = [{"time": "09:30", "price": 9.9, "volume": 100, "amount": 9900.0}]
        quote = {
            "name": "浦发银行",
            "pre_close": "9.90",
            "price": "9.95",
            "high": "10.00",
            "low": "9.80",
            "limit_up": "10.89",
            "limit_down": "8.91",
        }

        with (
            mock.patch.object(
                plugin_api,
                "_tencent_minute_points",
                return_value=points,
            ) as minute_mock,
            mock.patch.object(
                plugin_api,
                "_tencent_quote_detail",
                return_value=quote,
            ) as quote_mock,
        ):
            first = plugin_api.get_a_minute_line("sh600000")
            second = plugin_api.get_a_minute_line("sh600000")

        self.assertEqual(first, second)
        self.assertEqual(minute_mock.call_count, 1)
        self.assertEqual(quote_mock.call_count, 1)

    def test_stock_minute_returns_502_on_upstream_failure(self) -> None:
        with mock.patch.object(
            plugin_api,
            "_tencent_minute_points",
            side_effect=RuntimeError("offline"),
        ):
            with self.assertRaises(plugin_api.HTTPException) as raised:
                plugin_api.stock_minute("sh600000")
        self.assertEqual(raised.exception.status_code, 502)


class SyncVscodeDataTest(unittest.TestCase):
    def test_parse_jsonc_supports_comments_and_trailing_commas(self) -> None:
        value = sync_vscode_data.parse_jsonc(
            """
            {
              // comment
              "url": "https://example.com/a//b",
              "stocks": ["sh600000",],
            }
            """
        )

        self.assertEqual(value["url"], "https://example.com/a//b")
        self.assertEqual(value["stocks"], ["sh600000"])

    def test_read_extension_state_uses_exact_extension_row(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            vscode_user_dir = Path(temp_dir)
            database_path = vscode_user_dir / "globalStorage" / "state.vscdb"
            database_path.parent.mkdir(parents=True)
            with sqlite3.connect(database_path) as connection:
                connection.execute(
                    "CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB)"
                )
                connection.execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
                    (
                        sync_vscode_data.VSCODE_EXTENSION_STATE_KEY,
                        json.dumps({"leek-fund.stockTreeWatchCodes": ["sh600000"]}),
                    ),
                )
                connection.execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
                    ("other.extension", json.dumps({"private": "ignored"})),
                )

            value = sync_vscode_data.read_vscode_extension_state(vscode_user_dir)

        self.assertEqual(
            value,
            {"leek-fund.stockTreeWatchCodes": ["sh600000"]},
        )

    def test_build_import_state_maps_only_supported_corresponding_data(self) -> None:
        state = sync_vscode_data.build_import_state(
            {
                "leek-fund.stocks": ["SH600000", "hk00700"],
                "leek-fund.stockGroups": [
                    {
                        "id": "parent",
                        "name": "一级",
                        "category": "A Stock",
                        "stockCodes": [],
                    },
                    {
                        "id": "child",
                        "name": "二级",
                        "category": "A Stock",
                        "stockCodes": ["sh600000", "sz000001"],
                        "parentId": "parent",
                    },
                ],
                "leek-fund.statusBarStock": ["hk00700", "sz000001"],
            },
            {
                "leek-fund.stockTreeHoldingCodes": ["sh600000", "sz000001"],
                "leek-fund.stockTreeWatchCodes": ["hk00700"],
                "leek-fund.recommendedAStocks": {"items": ["sz000001"]},
            },
        )

        self.assertEqual(state["stocks"], ["sh600000", "hk00700"])
        self.assertEqual(state["groups"][1]["parent_id"], "parent")
        self.assertEqual(state["groups"][1]["stock_codes"], ["sh600000"])
        self.assertEqual(state["holding_codes"], ["sh600000"])
        self.assertEqual(state["watch_codes"], ["hk00700"])
        self.assertEqual(state["status_bar_stock_codes"], ["hk00700"])
        self.assertNotIn("recommendedAStocks", state)

    def test_write_import_state_backs_up_existing_target(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            hermes_home = Path(temp_dir)
            target = sync_vscode_data.target_state_path(hermes_home)
            target.parent.mkdir(parents=True)
            target.write_text('{"old": true}', encoding="utf-8")

            saved, backup = sync_vscode_data.write_import_state(
                plugin_api.default_state(),
                hermes_home,
            )

            self.assertIsNotNone(backup)
            assert backup
            self.assertEqual(
                json.loads(backup.read_text(encoding="utf-8")),
                {"old": True},
            )
            self.assertEqual(
                json.loads(target.read_text(encoding="utf-8")),
                saved,
            )


if __name__ == "__main__":
    unittest.main()
