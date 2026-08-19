#!/usr/bin/env python3

from html.parser import HTMLParser
from pathlib import Path
from datetime import date
import json
import struct
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://native-cube.com"
REDIRECT_PATH = Path("json-formatter/index.html")
INDEXABLE_PATHS = tuple(
    sorted(
        (
            path.relative_to(ROOT)
            for path in ROOT.rglob("index.html")
            if path.relative_to(ROOT) != REDIRECT_PATH
        ),
        key=lambda path: path.as_posix(),
    )
)
PAGES = {
    path: (
        f"{SITE_URL}/"
        if path == Path("index.html")
        else f"{SITE_URL}/{path.parent.as_posix()}/"
    )
    for path in INDEXABLE_PATHS
}
REQUIRED_META = {
    "description",
    "og:description",
    "og:image",
    "og:image:alt",
    "og:title",
    "og:url",
    "robots",
    "twitter:description",
    "twitter:image",
    "twitter:image:alt",
    "twitter:title",
}


class PageAudit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.h1_count = 0
        self.links = []
        self.meta = {}
        self.canonicals = []
        self.title = []
        self.json_ld = []
        self._in_title = False
        self._in_json_ld = False
        self._json_parts = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "h1":
            self.h1_count += 1
        if tag == "a" and values.get("href"):
            self.links.append(values["href"])
        rel = values.get("rel", "")
        if tag == "link" and "canonical" in rel.lower().split():
            canonical = values.get("href", "")
            self.canonicals.append(canonical)
            self.meta["canonical"] = canonical
        if tag == "meta":
            key = values.get("name") or values.get("property")
            if key:
                self.meta[key.lower()] = values.get("content", "")
            if values.get("http-equiv", "").lower() == "refresh":
                self.meta["refresh"] = values.get("content", "")
        if tag == "title":
            self._in_title = True
        if tag == "script" and values.get("type") == "application/ld+json":
            self._in_json_ld = True
            self._json_parts = []

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag == "script" and self._in_json_ld:
            self.json_ld.append("".join(self._json_parts))
            self._in_json_ld = False

    def handle_data(self, data):
        if self._in_title:
            self.title.append(data)
        if self._in_json_ld:
            self._json_parts.append(data)


def fail(message):
    print(f"SEO audit failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_page(relative_path):
    source = (ROOT / relative_path).read_text()
    if "native-cube.github.io" in source.lower():
        fail(f"{relative_path} references the non-canonical GitHub Pages hostname")
    forbidden = sorted(
        {
            codepoint
            for codepoint in map(ord, source)
            if (codepoint < 32 and codepoint not in {9, 10, 13})
            or 127 <= codepoint <= 159
        }
    )
    if forbidden:
        values = ", ".join(f"U+{codepoint:04X}" for codepoint in forbidden)
        fail(f"{relative_path} contains HTML-forbidden code points: {values}")
    parser = PageAudit()
    parser.feed(source)
    return parser


def assert_social_image(url):
    prefix = f"{SITE_URL}/"
    if not url.startswith(prefix):
        fail(f"social image must use an absolute site URL: {url}")

    image_path = ROOT / url.removeprefix(prefix)
    if not image_path.is_file():
        fail(f"social image does not exist: {image_path.relative_to(ROOT)}")

    with image_path.open("rb") as image:
        signature = image.read(24)
    if signature[:8] != b"\x89PNG\r\n\x1a\n":
        fail(f"social image is not PNG: {image_path.relative_to(ROOT)}")

    width, height = struct.unpack(">II", signature[16:24])
    if (width, height) != (1200, 630):
        fail(
            f"{image_path.relative_to(ROOT)} is {width}x{height}; expected 1200x630"
        )


for path, canonical in PAGES.items():
    page = parse_page(path)
    title = "".join(page.title).strip()
    if not title:
        fail(f"{path} has no title")
    if page.h1_count != 1:
        fail(f"{path} has {page.h1_count} h1 elements; expected exactly one")
    if len(page.canonicals) != 1:
        fail(f"{path} has {len(page.canonicals)} canonical links; expected exactly one")
    if page.meta.get("canonical") != canonical:
        fail(f"{path} canonical is not {canonical}")
    canonical_parts = urlsplit(canonical)
    if (
        canonical_parts.scheme != "https"
        or canonical_parts.netloc != "native-cube.com"
        or not canonical_parts.path.endswith("/")
        or canonical_parts.query
        or canonical_parts.fragment
    ):
        fail(f"{path} canonical is not a clean native-cube.com HTTPS URL")

    missing_meta = sorted(key for key in REQUIRED_META if not page.meta.get(key))
    if missing_meta:
        fail(f"{path} is missing metadata: {', '.join(missing_meta)}")
    if page.meta.get("og:url") != canonical:
        fail(f"{path} og:url does not match its canonical URL")
    robots = {
        directive.strip().lower()
        for directive in page.meta["robots"].split(",")
        if directive.strip()
    }
    if not {"index", "follow"}.issubset(robots):
        fail(f"{path} must explicitly allow indexing and link following")
    if {"noindex", "nofollow"} & robots:
        fail(f"{path} contains a restrictive robots directive")
    if page.meta.get("twitter:card") != "summary_large_image":
        fail(f"{path} does not use a large Twitter card")
    if page.meta["twitter:image"] != page.meta["og:image"]:
        fail(f"{path} uses different Open Graph and Twitter images")

    assert_social_image(page.meta["og:image"])
    for payload in page.json_ld:
        json.loads(payload)

redirect = parse_page(REDIRECT_PATH)
if redirect.meta.get("robots") != "noindex":
    fail(f"{REDIRECT_PATH} must remain noindex")
if redirect.meta.get("canonical") != PAGES[Path("yaml-formatter/index.html")]:
    fail(f"{REDIRECT_PATH} must canonicalize to /yaml-formatter/")
if "../yaml-formatter/" not in redirect.meta.get("refresh", ""):
    fail(f"{REDIRECT_PATH} meta refresh must target /yaml-formatter/")

namespace = {"sitemap": "http://www.sitemaps.org/schemas/sitemap/0.9"}
sitemap = ET.parse(ROOT / "sitemap.xml")
sitemap_locations = [
    node.text for node in sitemap.findall(".//sitemap:loc", namespace) if node.text
]
sitemap_urls = set(sitemap_locations)
if len(sitemap_locations) != len(sitemap_urls):
    fail("sitemap.xml contains duplicate canonical URLs")
expected_urls = set(PAGES.values())
if sitemap_urls != expected_urls:
    fail(
        "sitemap URLs differ from canonical pages: "
        f"expected {sorted(expected_urls)}, found {sorted(sitemap_urls)}"
    )
for url_node in sitemap.findall(".//sitemap:url", namespace):
    location = url_node.findtext("sitemap:loc", namespaces=namespace)
    last_modified = url_node.findtext("sitemap:lastmod", namespaces=namespace)
    if not last_modified:
        fail(f"sitemap entry {location or '<missing loc>'} has no lastmod value")
    try:
        modified_date = date.fromisoformat(last_modified)
    except ValueError:
        fail(f"sitemap entry {location} has invalid lastmod value {last_modified}")
    if modified_date > date.today():
        fail(f"sitemap entry {location} has a future lastmod value")

robots = (ROOT / "robots.txt").read_text()
if f"Sitemap: {SITE_URL}/sitemap.xml" not in robots:
    fail("robots.txt does not advertise the canonical sitemap")
if "Disallow:" in robots:
    fail("robots.txt must not block indexable site paths")

if (ROOT / "CNAME").read_text().strip() != "native-cube.com":
    fail("CNAME must contain only the canonical native-cube.com hostname")

verification_files = sorted(ROOT.glob("google*.html"))
if not verification_files:
    fail("Google Search Console verification file is missing")
for verification_file in verification_files:
    expected = f"google-site-verification: {verification_file.name}"
    if verification_file.read_text().strip() != expected:
        fail(f"{verification_file.name} does not contain its expected verification token")

landing = parse_page(Path("index.html"))
landing_links = set(landing.links)
for canonical in PAGES.values():
    if canonical == f"{SITE_URL}/":
        continue
    relative = canonical.removeprefix(f"{SITE_URL}/")
    if f"./{relative}" not in landing_links:
        fail(f"landing page does not link to {relative}")
if "./json-formatter/" in landing_links:
    fail("landing page must not link internally to the redirect alias")

print(
    "SEO audit passed: "
    f"{len(PAGES)} canonical pages, social cards, sitemap, robots, and redirect"
)
