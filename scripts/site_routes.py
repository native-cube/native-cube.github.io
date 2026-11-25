"""Routing and crawl metadata shared by the local and deployed site audits."""

from html.parser import HTMLParser
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://native-cube.com"
HOSTNAMES = ("native-cube.com", "www.native-cube.com", "native-cube.github.io")
REDIRECTS = {
    Path("json-formatter/index.html"): Path("yaml-formatter/index.html"),
}
MAINTAINER_DOCS = ("AGENTS", "README", "SEARCH_CONSOLE")
SITEMAP_NAMESPACE = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def page_url(path):
    return f"{SITE_URL}/" if path == Path("index.html") else f"{SITE_URL}/{path.parent.as_posix()}/"


def blocks_search(directives):
    restricted = {"noindex", "nofollow", "none"}
    return any(restricted.intersection(re.split(r"[\s,;]+", value.lower())) for value in directives)


class RoutingMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonicals = []
        self.refreshes = []
        self.robots = []
        self.outside_head = []
        self._in_head = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "head":
            self._in_head = True
        if tag == "link" and "canonical" in (values.get("rel") or "").lower().split():
            self.canonicals.append(values.get("href") or "")
            if not self._in_head:
                self.outside_head.append("canonical")
        if tag == "meta":
            content = values.get("content") or ""
            if (values.get("http-equiv") or "").lower() == "refresh":
                self.refreshes.append(content)
                if not self._in_head:
                    self.outside_head.append("meta refresh")
            if (values.get("name") or "").lower() in {"robots", "googlebot"}:
                self.robots.append(content)

    def handle_endtag(self, tag):
        if tag == "head":
            self._in_head = False
