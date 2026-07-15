"""Regression tests for taxonomy refresh network retries."""

from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from urllib.error import HTTPError


ROOT_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT_DIR / "scripts" / "refresh_taxonomy.py"

spec = importlib.util.spec_from_file_location("refresh_taxonomy_fetch", MODULE_PATH)
assert spec is not None and spec.loader is not None
refresh_taxonomy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = refresh_taxonomy
spec.loader.exec_module(refresh_taxonomy)


class RefreshFetchTests(TestCase):
    def test_retries_timeout_then_returns_payload(self) -> None:
        response = io.BytesIO(b'{"status": "ok"}')

        with (
            patch.object(refresh_taxonomy, "urlopen", side_effect=[TimeoutError("timed out"), response]) as urlopen,
            patch.object(refresh_taxonomy.time, "sleep") as sleep,
        ):
            payload = refresh_taxonomy.fetch_json("https://example.test/taxa")

        self.assertEqual(payload, {"status": "ok"})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(2)

    def test_retries_transient_http_error_then_returns_payload(self) -> None:
        url = "https://example.test/taxa"
        response = io.BytesIO(b'{"status": "ok"}')
        transient_error = HTTPError(url, 502, "Bad Gateway", {}, None)

        with (
            patch.object(refresh_taxonomy, "urlopen", side_effect=[transient_error, response]) as urlopen,
            patch.object(refresh_taxonomy.time, "sleep") as sleep,
        ):
            payload = refresh_taxonomy.fetch_json(url)

        self.assertEqual(payload, {"status": "ok"})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(2)

    def test_does_not_retry_permanent_http_error(self) -> None:
        url = "https://example.test/taxa"
        permanent_error = HTTPError(url, 404, "Not Found", {}, None)

        with (
            patch.object(refresh_taxonomy, "urlopen", side_effect=permanent_error) as urlopen,
            patch.object(refresh_taxonomy.time, "sleep") as sleep,
        ):
            with self.assertRaisesRegex(RuntimeError, "HTTP 404"):
                refresh_taxonomy.fetch_json(url)

        urlopen.assert_called_once()
        sleep.assert_not_called()
