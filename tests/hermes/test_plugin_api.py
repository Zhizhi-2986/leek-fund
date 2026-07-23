from __future__ import annotations

import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock


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
            ["holding", "watch", "ungrouped", "group-1"],
        )
        self.assertEqual(a_stock["groups"][0]["stocks"][0]["code"], "sh600000")
        self.assertEqual(a_stock["groups"][1]["stocks"][0]["code"], "sh600000")
        self.assertEqual(a_stock["groups"][2]["stocks"], [])
        self.assertEqual(a_stock["groups"][3]["stocks"][0]["code"], "sh600000")
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
        self.assertEqual(plugin_api.load_state()["stocks"], [
            "sh600000",
            "hk00700",
            "usr_aapl",
        ])
        self.assertEqual(
            [item["code"] for item in snapshot["status_bar"]],
            plugin_api.DEFAULT_INDEX_CODES + ["sh600000"],
        )

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

    def test_reorder_ungrouped_stock_persists_global_order(self) -> None:
        plugin_api.save_state(
            {
                "stocks": ["sh600000", "sh600001", "sh600002"],
                "groups": [
                    {
                        "id": "group-1",
                        "name": "一组",
                        "category": "A",
                        "stock_codes": ["sh600002"],
                    }
                ],
            }
        )

        plugin_api.reorder_stock(
            "sh600001",
            {
                "target_group_id": "ungrouped",
                "target_code": "sh600000",
                "placement": "before",
            },
        )
        plugin_api.reorder_stock(
            "sh600002",
            {
                "target_group_id": "ungrouped",
                "target_code": "sh600001",
                "placement": "before",
            },
        )

        state = plugin_api.load_state()
        self.assertEqual(
            state["stocks"],
            ["sh600002", "sh600001", "sh600000"],
        )
        self.assertEqual(state["groups"][0]["stock_codes"], [])

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
        parent = categories[0]["groups"][3]

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
                        json.dumps(
                            {"leek-fund.stockTreeWatchCodes": ["sh600000"]}
                        ),
                    ),
                )
                connection.execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
                    ("other.extension", json.dumps({"private": "ignored"})),
                )

            value = sync_vscode_data.read_vscode_extension_state(
                vscode_user_dir
            )

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
