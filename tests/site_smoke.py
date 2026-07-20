#!/usr/bin/env python3
"""Browser smoke tests for the static music site."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright


PUBLIC_DIR = Path(__file__).resolve().parents[1] / "public"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        return


class MusicSiteSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = partial(QuietHandler, directory=str(PUBLIC_DIR))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def open_page(self, *, viewport, reduced_motion="no-preference"):
        context = self.browser.new_context(
            viewport=viewport,
            reduced_motion=reduced_motion,
            color_scheme="dark",
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(self.base_url, wait_until="domcontentloaded")
        page.wait_for_selector(".track", state="attached")
        page.wait_for_function(
            "() => document.querySelector('#hero-sphere')?.dataset.ready === 'true'",
            timeout=5000,
        )
        return context, page, errors

    def test_desktop_renders_sphere_and_every_track(self):
        context, page, errors = self.open_page(viewport={"width": 1440, "height": 1000})
        try:
            expected_tracks = page.evaluate(
                "() => fetch('songs.json').then(response => response.json()).then(songs => songs.length)"
            )
            self.assertEqual(page.locator(".track").count(), expected_tracks)
            self.assertEqual(page.locator(".track-disc").count(), expected_tracks)

            canvas = page.locator("#hero-sphere")
            box = canvas.bounding_box()
            self.assertIsNotNone(box)
            self.assertGreater(box["width"], 300)
            self.assertGreater(
                page.evaluate("() => document.querySelector('#hero-sphere').toDataURL().length"),
                1000,
            )
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_mobile_layout_has_no_horizontal_overflow(self):
        context, page, errors = self.open_page(viewport={"width": 390, "height": 844})
        try:
            overflow = page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            self.assertLessEqual(overflow, 1)
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_reduced_motion_keeps_a_static_sphere(self):
        context, page, errors = self.open_page(
            viewport={"width": 1280, "height": 900},
            reduced_motion="reduce",
        )
        try:
            opacity = float(
                page.locator("#hero-sphere-wrap").evaluate(
                    "(element) => getComputedStyle(element).opacity"
                )
            )
            self.assertGreater(opacity, 0.3)
            self.assertGreater(
                page.evaluate("() => document.querySelector('#hero-sphere').toDataURL().length"),
                1000,
            )
            self.assertEqual(errors, [])
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
