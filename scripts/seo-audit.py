#!/usr/bin/env python3

from html.parser import HTMLParser
from pathlib import Path
import json
import struct
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://native-cube.github.io"
PAGES = {
    Path("index.html"): f"{SITE_URL}/",
    Path("k8s-manifest-builder/index.html"): f"{SITE_URL}/k8s-manifest-builder/",
    Path("visual-subnet-calculator/index.html"): f"{SITE_URL}/visual-subnet-calculator/",
    Path("yaml-formatter/index.html"): f"{SITE_URL}/yaml-formatter/",
    Path("terraform-modules/index.html"): f"{SITE_URL}/terraform-modules/",
}
REDIRECT_PATH = Path("json-formatter/index.html")
REQUIRED_META = {
    "description",
    "og:description",
    "og:image",
    "og:image:alt",
    "og:title",
    "og:url",
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
        if tag == "link" and values.get("rel") == "canonical":
            self.meta["canonical"] = values.get("href", "")
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
    parser = PageAudit()
    parser.feed((ROOT / relative_path).read_text())
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
    if page.meta.get("canonical") != canonical:
        fail(f"{path} canonical is not {canonical}")

    missing_meta = sorted(key for key in REQUIRED_META if not page.meta.get(key))
    if missing_meta:
        fail(f"{path} is missing metadata: {', '.join(missing_meta)}")
    if page.meta.get("og:url") != canonical:
        fail(f"{path} og:url does not match its canonical URL")
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
sitemap_urls = {
    node.text for node in sitemap.findall(".//sitemap:loc", namespace) if node.text
}
expected_urls = set(PAGES.values())
if sitemap_urls != expected_urls:
    fail(
        "sitemap URLs differ from canonical pages: "
        f"expected {sorted(expected_urls)}, found {sorted(sitemap_urls)}"
    )

robots = (ROOT / "robots.txt").read_text()
if f"Sitemap: {SITE_URL}/sitemap.xml" not in robots:
    fail("robots.txt does not advertise the canonical sitemap")

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
