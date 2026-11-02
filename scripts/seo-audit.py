#!/usr/bin/env python3

from html.parser import HTMLParser
from pathlib import Path
from datetime import date
import json
import struct
import sys
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urljoin, urlsplit


ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://native-cube.com"
REDIRECTS = {
    Path("json-formatter/index.html"): Path("yaml-formatter/index.html"),
}
INDEXABLE_PATHS = tuple(
    sorted(
        (
            path.relative_to(ROOT)
            for path in ROOT.rglob("index.html")
            if path.relative_to(ROOT) not in REDIRECTS
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
        self.language = ""
        self.headings = []
        self.examples = []
        self.navigation_labels = []
        self.links = []
        self.meta = {}
        self.canonicals = []
        self.title = []
        self.json_ld = []
        self._in_title = False
        self._in_json_ld = False
        self._json_parts = []
        self._heading_tag = None
        self._heading_parts = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "html":
            self.language = values.get("lang", "")
        if tag == "nav":
            self.navigation_labels.append(values.get("aria-label", ""))
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "h1":
            self.h1_count += 1
        if tag in {"h1", "h2", "h3"}:
            self._heading_tag = tag
            self._heading_parts = []
        if tag == "br" and self._heading_tag:
            self._heading_parts.append(" ")
        if values.get("data-example"):
            self.examples.append(values["data-example"])
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
        if tag == self._heading_tag:
            self.headings.append((tag, " ".join("".join(self._heading_parts).split())))
            self._heading_tag = None
        if tag == "title":
            self._in_title = False
        if tag == "script" and self._in_json_ld:
            self.json_ld.append("".join(self._json_parts))
            self._in_json_ld = False

    def handle_data(self, data):
        if self._heading_tag:
            self._heading_parts.append(data)
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


def structured_entities(data):
    if isinstance(data, list):
        return [entity for item in data for entity in structured_entities(item)]
    if not isinstance(data, dict):
        fail("JSON-LD must contain objects or arrays of objects")
    if "@graph" in data:
        return structured_entities(data["@graph"])
    return [data]


def assert_tool_seo(page, entities, slug):
    canonical = f"{SITE_URL}/{slug}/"
    by_type = {entity.get("@type"): entity for entity in entities if isinstance(entity.get("@type"), str)}
    required = {"WebPage", "WebApplication", "BreadcrumbList", "Person", "ImageObject"}
    missing = required - by_type.keys()
    if missing:
        fail(f"{slug} JSON-LD is missing entities: {', '.join(sorted(missing))}")
    if any(sum(entity.get("@type") == entity_type for entity in entities) != 1 for entity_type in required):
        fail(f"{slug} must declare exactly one entity of each required type")
    identities = [by_type[entity_type].get("@id", "") for entity_type in required]
    if any(not identity.startswith(f"{canonical}#") for identity in identities) or len(set(identities)) != len(identities):
        fail(f"{slug} structured-data entities must have unique page-scoped IDs")
    webpage = by_type["WebPage"]
    application = by_type["WebApplication"]
    breadcrumb = by_type["BreadcrumbList"]
    author = by_type["Person"]
    social_image = by_type["ImageObject"]
    title = "".join(page.title).strip()
    if not (webpage.get("name") == page.meta["og:title"] == page.meta["twitter:title"] == title):
        fail(f"{slug} page, social, and structured-data titles must agree")
    if webpage.get("description") != page.meta["description"]:
        fail(f"{slug} structured-data description must match its meta description")
    if webpage.get("inLanguage", "").lower() != page.language.lower():
        fail(f"{slug} structured-data language must match the HTML language")
    for relationship, entity in [
        ("mainEntity", application),
        ("breadcrumb", breadcrumb),
        ("author", author),
        ("primaryImageOfPage", social_image),
    ]:
        if webpage.get(relationship, {}).get("@id") != entity.get("@id"):
            fail(f"{slug} WebPage {relationship} must reference its actual entity")
    if application.get("mainEntityOfPage", {}).get("@id") != webpage.get("@id"):
        fail(f"{slug} application must reference its WebPage")
    if webpage.get("url") != canonical or application.get("url") != canonical:
        fail(f"{slug} structured-data URLs must use the clean canonical")
    offer = application.get("offers", {})
    if application.get("isAccessibleForFree") is not True or offer.get("price") not in (0, "0"):
        fail(f"{slug} application must accurately describe its free access")
    if social_image.get("url") != page.meta["og:image"] or application.get("image") != social_image.get("url"):
        fail(f"{slug} structured data must use the actual social image")
    if (social_image.get("width"), social_image.get("height")) != (1200, 630):
        fail(f"{slug} structured-data social image dimensions are incorrect")
    if author.get("url") not in page.links:
        fail(f"{slug} structured-data author must have a visible attribution link")
    expected_items = [
        {"@type": "ListItem", "position": 1, "name": "Native Cube", "item": f"{SITE_URL}/"},
        {"@type": "ListItem", "position": 2, "name": application.get("name"), "item": canonical},
    ]
    if breadcrumb.get("itemListElement") != expected_items:
        fail(f"{slug} breadcrumb must identify the home page and current tool")
    if not {"Breadcrumb", "On this page"}.issubset(page.navigation_labels):
        fail(f"{slug} must retain its visible breadcrumb and section navigation")


def assert_crontab_seo(page, entities):
    assert_tool_seo(page, entities, "crontab")
    h1 = next((text.lower() for tag, text in page.headings if tag == "h1"), "")
    if "crontab" not in h1 or "generator" not in h1:
        fail("crontab must have a descriptive generator heading in the original HTML")
    if not {"how-to-title", "syntax-title", "examples-title", "platform-title", "faq-title"}.issubset(page.ids):
        fail("crontab must retain its static guide, examples, scheduler reference, and FAQ")
    if not {"*/5 * * * *", "0 * * * *", "0 0 * * *"}.issubset(page.examples):
        fail("crontab must provide static examples for five-minute, hourly, and daily schedules")


def assert_json_diff_seo(page, entities):
    assert_tool_seo(page, entities, "json-diff")
    by_type = {entity.get("@type"): entity for entity in entities if isinstance(entity.get("@type"), str)}
    application = by_type["WebApplication"]
    webpage = by_type["WebPage"]
    h1 = next((text for tag, text in page.headings if tag == "h1"), "")
    if h1 != application.get("name"):
        fail("json-diff application name must match its visible main heading")
    if not (application.get("description") == page.meta["description"] == page.meta["og:description"] == page.meta["twitter:description"]):
        fail("json-diff application, page, and social descriptions must agree")
    if not all(term in "".join(page.title).lower() for term in ["json", "yaml", "diff"]):
        fail("json-diff title must describe both supported formats and comparison")
    if application.get("author", {}).get("@id") != by_type["Person"].get("@id"):
        fail("json-diff application must identify its actual author")
    if not isinstance(application.get("featureList"), list) or len(application["featureList"]) < 4:
        fail("json-diff application must describe its comparison features")
    if not webpage.get("dateModified"):
        fail("json-diff must declare its actual modification date")
    required_ids = {"comparison-workspace", "comparison-results", "guide-title", "examples-title", "faq-title", "related-tools-title"}
    if not required_ids.issubset(page.ids):
        fail("json-diff must retain its static guide, examples, FAQ, and related tools")
    if not {"json-original", "json-updated", "yaml-original", "yaml-updated"}.issubset(page.examples):
        fail("json-diff must retain original and updated examples in both formats")
    canonical = f"{SITE_URL}/json-diff/"
    targets = {urljoin(canonical, link) for link in page.links}
    expected = {f"{SITE_URL}/{slug}/" for slug in ["yaml-formatter", "k8s-manifest-builder", "helm-chart-builder"]}
    if not expected.issubset(targets):
        fail("json-diff must retain links to related configuration tools")


parsed_pages = {}
page_entities = {}
titles = set()
descriptions = set()
for path, canonical in PAGES.items():
    page = parse_page(path)
    parsed_pages[canonical] = page
    title = "".join(page.title).strip()
    if not title:
        fail(f"{path} has no title")
    if title in titles:
        fail(f"{path} repeats another page's title")
    titles.add(title)
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
    if page.meta["description"] in descriptions:
        fail(f"{path} repeats another page's description")
    descriptions.add(page.meta["description"])
    if "refresh" in page.meta:
        fail(f"{path} is a canonical page but contains a redirect")
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
    if not page.json_ld:
        fail(f"{path} has no structured data")
    entities = []
    for payload in page.json_ld:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as error:
            fail(f"{path} has invalid JSON-LD: {error}")
        entities.extend(structured_entities(data))
    page_entities[canonical] = entities
    if not any(entity.get("url") == canonical for entity in entities):
        fail(f"{path} structured data does not identify its canonical URL")

crontab_url = PAGES[Path("crontab/index.html")]
assert_crontab_seo(parsed_pages[crontab_url], page_entities[crontab_url])
json_diff_url = PAGES[Path("json-diff/index.html")]
assert_json_diff_seo(parsed_pages[json_diff_url], page_entities[json_diff_url])

for canonical, page in parsed_pages.items():
    if len(page.ids) != len(set(page.ids)):
        fail(f"{canonical} has duplicate HTML IDs")
    for link in page.links:
        target = urlsplit(urljoin(canonical, link))
        if target.hostname in {"www.native-cube.com", "native-cube.github.io"}:
            fail(f"{canonical} links to a non-canonical hostname: {link}")
        if target.hostname != "native-cube.com":
            continue
        target_url = f"{target.scheme}://{target.netloc}{target.path}"
        if target_url not in parsed_pages:
            fail(f"{canonical} links to a non-canonical or missing page: {link}")
        if target.fragment and unquote(target.fragment) not in parsed_pages[target_url].ids:
            fail(f"{canonical} links to a missing fragment: {link}")

for redirect_path, target_path in REDIRECTS.items():
    redirect = parse_page(redirect_path)
    redirect_target = PAGES[target_path]
    if "noindex" in redirect.meta.get("robots", "").lower():
        fail(f"{redirect_path} must consolidate with its target without noindex")
    if redirect.canonicals != [redirect_target]:
        fail(f"{redirect_path} must canonicalize to {redirect_target}")
    if redirect.meta.get("refresh") != f"0; url={redirect_target}":
        fail(f"{redirect_path} must immediately redirect to the absolute canonical URL")
    if redirect_target not in redirect.links:
        fail(f"{redirect_path} must provide a direct fallback link to its target")

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
    if location == PAGES[Path("terraform-modules/index.html")]:
        catalogue = json.loads((ROOT / "terraform-modules/modules.json").read_text())
        if modified_date < date.fromisoformat(catalogue["synced_at"].split("T")[0]):
            fail("Terraform sitemap lastmod predates the published catalogue")
    if location in {crontab_url, json_diff_url}:
        webpage = next(entity for entity in page_entities[location] if entity.get("@type") == "WebPage")
        if webpage.get("dateModified") != last_modified:
            fail(f"{location} sitemap lastmod must match its WebPage dateModified")

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
for redirect_path in REDIRECTS:
    if f"./{redirect_path.parent.as_posix()}/" in landing_links:
        fail(f"landing page must not link internally to the redirect alias {redirect_path}")

for source in ["yaml-formatter/index.html", "k8s-manifest-builder/index.html"]:
    page = parsed_pages[PAGES[Path(source)]]
    targets = {urljoin(PAGES[Path(source)], link) for link in page.links}
    if crontab_url not in targets:
        fail(f"{source} must retain its related cron scheduling link")


for source in ["index.html", "yaml-formatter/index.html"]:
    page = parsed_pages[PAGES[Path(source)]]
    targets = {urljoin(PAGES[Path(source)], link) for link in page.links}
    if json_diff_url not in targets:
        fail(f"{source} must retain its link to JSON and YAML comparison")

print(
    "SEO audit passed: "
    f"{len(PAGES)} canonical pages, social cards, sitemap, robots, "
    f"and {len(REDIRECTS)} redirect{'s' if len(REDIRECTS) != 1 else ''}"
)
