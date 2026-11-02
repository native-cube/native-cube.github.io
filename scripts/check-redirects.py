#!/usr/bin/env python3
"""Check deployed HTTP and instant meta-refresh redirects without dependencies."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://native-cube.com"
HOSTS = (
    SITE_URL,
    "http://native-cube.com",
    "https://www.native-cube.com",
    "http://www.native-cube.com",
    "https://native-cube.github.io",
    "http://native-cube.github.io",
)
PERMANENT = {301, 308}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonicals = []
        self.refreshes = []
        self.robots = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "link" and "canonical" in values.get("rel", "").lower().split():
            self.canonicals.append(values.get("href", ""))
        if tag == "meta":
            if values.get("http-equiv", "").lower() == "refresh":
                self.refreshes.append(values.get("content", ""))
            if values.get("name", "").lower() in {"robots", "googlebot"}:
                self.robots.append(values.get("content", "").lower())


def fetch(url, user_agent):
    opener = build_opener(NoRedirect)
    try:
        response = opener.open(Request(url, headers={"User-Agent": user_agent}), timeout=20)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read().decode("utf-8", "replace")


def check_url(source, expected, user_agent):
    current = source
    seen = set()
    chain = []
    try:
        for _ in range(6):
            if current in seen:
                raise ValueError("redirect loop")
            seen.add(current)
            status, headers, body = fetch(current, user_agent)
            chain.append(f"{status} {current}")
            if 300 <= status < 400:
                if status not in PERMANENT:
                    raise ValueError(f"expected a permanent redirect, got {status}")
                location = headers.get("Location")
                if not location:
                    raise ValueError("redirect has no Location header")
                destination = urljoin(current, location)
            elif status == 200:
                page = Page()
                page.feed(body)
                directives = page.robots + [headers.get("X-Robots-Tag", "").lower()]
                if any("noindex" in value or "nofollow" in value for value in directives):
                    raise ValueError("indexing or following is blocked")
                if page.refreshes:
                    if len(page.refreshes) != 1:
                        raise ValueError("multiple meta-refresh redirects")
                    match = re.fullmatch(r"0\s*;\s*url=(.+)", page.refreshes[0], re.I)
                    if not match:
                        raise ValueError("meta refresh must be an instant permanent redirect")
                    destination = urljoin(current, match[1].strip("\"'"))
                    if destination != expected or page.canonicals != [expected]:
                        raise ValueError("meta refresh and canonical must point directly to target")
                    chain.append(f"meta refresh -> {destination}")
                else:
                    # GitHub Pages serves /index.html duplicates with 200. Their
                    # canonical consolidates them without a client-side redirect.
                    duplicate = expected + "index.html"
                    if current not in {expected, duplicate}:
                        raise ValueError(f"chain ended at {current}, expected {expected}")
                    if page.canonicals != [expected]:
                        raise ValueError(f"expected exactly one canonical: {expected}")
                    if "text/html" not in headers.get("Content-Type", ""):
                        raise ValueError("target is not served as HTML")
                    return True, " -> ".join(chain)
            else:
                raise ValueError(f"unexpected HTTP {status}")
            target = urlsplit(destination)
            if target.hostname not in {"native-cube.com", "www.native-cube.com", "native-cube.github.io"}:
                raise ValueError(f"redirect leaves the site: {destination}")
            if target.scheme != "https":
                raise ValueError(f"redirect does not use HTTPS: {destination}")
            current = destination
        raise ValueError("more than five redirects")
    except Exception as error:
        return False, f"{' -> '.join(chain) or source}: {error}"


def redirect_cases():
    namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    sitemap = ET.parse(ROOT / "sitemap.xml")
    cases = {}
    for node in sitemap.findall("s:url/s:loc", namespace):
        canonical = node.text
        if not canonical or not canonical.startswith(SITE_URL + "/"):
            raise ValueError("sitemap contains a non-canonical URL")
        path = urlsplit(canonical).path
        for host in HOSTS:
            cases[host + path] = canonical
        cases[canonical + "index.html"] = canonical
        if path != "/":
            cases[canonical.rstrip("/")] = canonical
    aliases = {
        "/json-formatter/": "/yaml-formatter/",
    }
    for alias, destination in aliases.items():
        target = SITE_URL + destination
        for host in HOSTS:
            cases[host + alias] = target
        cases[SITE_URL + alias.rstrip("/")] = target
        cases[SITE_URL + alias + "index.html"] = target
    return list(cases.items())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-agent", default="NativeCubeSEOAudit/1.0")
    args = parser.parse_args()
    cases = redirect_cases()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda case: check_url(*case, args.user_agent), cases))
    for passed, detail in results:
        print(f"{'PASS' if passed else 'FAIL'} {detail}")
    failures = sum(not passed for passed, _ in results)
    print(f"Live redirect audit: {len(results) - failures}/{len(results)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
