"""Hermes plugin registration.

The plugin intentionally exposes no model tools or lifecycle hooks. Its Python
surface is the private REST API declared in dashboard/manifest.json.
"""


def register(_ctx) -> None:
    """Keep general-plugin discovery valid without adding agent capabilities."""
