#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HERMES_TARGET_HOME="${HERMES_HOME:-${HOME}/.hermes}"
BACKEND_TARGET="${HERMES_TARGET_HOME}/plugins/leek-fund"
DESKTOP_TARGET="${HERMES_TARGET_HOME}/desktop-plugins/leek-fund"
HERMES_CLI="${HERMES_BIN:-hermes}"

mkdir -p "${BACKEND_TARGET}/dashboard" "${DESKTOP_TARGET}"

cp "${SOURCE_DIR}/plugin.yaml" "${BACKEND_TARGET}/plugin.yaml"
cp "${SOURCE_DIR}/__init__.py" "${BACKEND_TARGET}/__init__.py"
cp "${SOURCE_DIR}/dashboard/manifest.json" "${BACKEND_TARGET}/dashboard/manifest.json"
cp "${SOURCE_DIR}/dashboard/plugin_api.py" "${BACKEND_TARGET}/dashboard/plugin_api.py"
cp "${SOURCE_DIR}/desktop/plugin.js" "${DESKTOP_TARGET}/plugin.js"

if command -v "${HERMES_CLI}" >/dev/null 2>&1; then
  "${HERMES_CLI}" plugins enable --no-allow-tool-override leek-fund
  echo "LeekFund backend enabled."
else
  echo "Hermes CLI was not found. Enable the backend manually: hermes plugins enable --no-allow-tool-override leek-fund"
fi

echo "Installed backend: ${BACKEND_TARGET}"
echo "Installed Desktop plugin: ${DESKTOP_TARGET}/plugin.js"
echo "Fully quit and reopen Hermes Desktop so both the backend routes and Desktop plugin are loaded."
