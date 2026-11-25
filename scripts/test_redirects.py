#!/usr/bin/env python3

from email.message import Message
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest
from unittest.mock import patch

from site_routes import SITE_URL, SITEMAP_NAMESPACE


spec = spec_from_file_location("check_redirects", Path(__file__).with_name("check-redirects.py"))
audit = module_from_spec(spec)
spec.loader.exec_module(audit)
CANONICAL = f"{SITE_URL}/yaml-formatter/"
ALIAS = f"{SITE_URL}/json-formatter/"
VARIANTS = audit.route_variants({f"{SITE_URL}/", CANONICAL})


def response(status=200, head="", body="", headers=()):
    fields = Message()
    fields["Content-Type"] = "text/html; charset=utf-8"
    for name, value in headers:
        fields[name] = value
    return status, fields, f"<html><head>{head}</head><body>{body}</body></html>"


def html(canonical=CANONICAL, extra="", headers=()):
    return response(head=f'<link rel="canonical" href="{canonical}">{extra}', headers=headers)


class RedirectTests(unittest.TestCase):
    def check(self, source, responses):
        with patch.object(audit, "fetch", side_effect=lambda url, _: responses[url]):
            return audit.check_url(source, VARIANTS, "NativeCubeTest")

    def test_distinguishes_canonical_pages_and_200_alternates(self):
        self.assertEqual(self.check(CANONICAL, {CANONICAL: html()})[0], "canonical")
        for suffix in ("index.html", "?source=audit"):
            alternate = CANONICAL + suffix
            category, detail = self.check(alternate, {alternate: html()})
            self.assertEqual(category, "alternate")
            self.assertTrue(detail.endswith(f"canonical {CANONICAL}"))

    def test_rejects_a_redirect_from_a_sitemap_url(self):
        category, detail = self.check(CANONICAL, {
            CANONICAL: response(301, headers=(("Location", "index.html"),)),
        })
        self.assertEqual(category, "error")
        self.assertIn("canonical sitemap URL redirects", detail)

    def test_follows_host_and_path_redirects_then_the_clean_alias(self):
        source = "http://native-cube.github.io/json-formatter?source=audit"
        slashless = f"{SITE_URL}/json-formatter?source=audit"
        alias = ALIAS + "?source=audit"
        category, detail = self.check(source, {
            source: response(301, headers=(("Location", slashless),)),
            slashless: response(301, headers=(("Location", "/json-formatter/?source=audit"),)),
            alias: html(extra=f'<meta http-equiv="refresh" content="0; url={CANONICAL}">'),
            CANONICAL: html(),
        })
        self.assertEqual(category, "redirect")
        self.assertIn(f"instant refresh to {CANONICAL}", detail)
        self.assertTrue(detail.endswith(f"200 {CANONICAL}"))

    def test_traces_an_unlisted_source_to_an_existing_canonical(self):
        source = f"{SITE_URL}/legacy/"
        category, _ = self.check(source, {
            source: response(308, headers=(("Location", "/yaml-formatter/"),)),
            CANONICAL: html(),
        })
        self.assertEqual(category, "redirect")

    def test_flags_loops_missing_locations_and_offsite_destinations(self):
        source = CANONICAL.rstrip("/")
        for headers, reason in (
            ((("Location", "#loop"),), "redirect loop"),
            ((), "no Location"),
            ((("Location", "https://example.com/"),), "outside the configured site origins"),
        ):
            with self.subTest(reason=reason):
                category, detail = self.check(source, {source: response(301, headers=headers)})
                self.assertEqual(category, "error")
                self.assertIn(reason, detail)

    def test_rejects_wrong_duplicate_delayed_or_empty_refreshes(self):
        instant = f'<meta http-equiv="refresh" content="0; url={CANONICAL}">'
        for extra, reason in (
            (instant.replace(CANONICAL, f"{SITE_URL}/"), "same target"),
            (instant + instant, "multiple refresh"),
            (instant.replace("0;", "1;"), "must be an instant redirect"),
            (instant.replace(CANONICAL, "&quot;&quot;"), "no destination"),
        ):
            with self.subTest(reason=reason):
                category, detail = self.check(ALIAS, {ALIAS: html(extra=extra)})
                self.assertEqual(category, "error")
                self.assertIn(reason, detail)

    def test_rejects_hidden_or_misplaced_canonical_signals(self):
        bad_pages = (
            html(extra='<meta name="googlebot" content="none">'),
            html(headers=(("X-Robots-Tag", "index"), ("X-Robots-Tag", "noindex"))),
            response(body=f'<link rel="canonical" href="{CANONICAL}">'),
        )
        for page in bad_pages:
            with self.subTest(page=page[2]):
                self.assertEqual(self.check(CANONICAL, {CANONICAL: page})[0], "error")

    def test_sitemap_rejects_aliases_fragments_queries_and_duplicates(self):
        for locations in ((ALIAS,), (CANONICAL + "#guide",), (CANONICAL + "?test",), (CANONICAL, CANONICAL)):
            with self.subTest(locations=locations):
                urls = "".join(f"<url><loc>{url}</loc></url>" for url in locations)
                with self.assertRaises(ValueError):
                    audit.sitemap_urls(f'<urlset xmlns="{SITEMAP_NAMESPACE["s"]}">{urls}</urlset>')


if __name__ == "__main__":
    unittest.main()
