#!/usr/bin/env python3
"""Check the deployed crawl files, canonical pages, and redirect chains."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from http.client import HTTPException
import re
import sys
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request
import xml.etree.ElementTree as ET

from site_routes import (
    HOSTNAMES,
    MAINTAINER_DOCS,
    REDIRECTS,
    ROOT,
    SITE_URL,
    SITEMAP_NAMESPACE,
    RoutingMetadata,
    blocks_search,
    page_url,
)

PERMANENT = {301, 308}
MAX_REDIRECTS = 5


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def site_url(url):
    parts = urlsplit(url)
    port = {"http": 80, "https": 443}.get(parts.scheme)
    host = parts.hostname
    if not port or host not in HOSTNAMES or parts.netloc.lower() not in {host, f"{host}:{port}"}:
        raise ValueError(f"URL is outside the configured site origins: {url}")
    return urlunsplit((parts.scheme, host, parts.path or "/", parts.query, ""))


@lru_cache(maxsize=256)
def fetch(url, user_agent):
    opener = build_opener(NoRedirect)
    try:
        response = opener.open(Request(url, headers={"User-Agent": user_agent}), timeout=12)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read().decode("utf-8", "replace")


def media_type(headers):
    return headers.get("Content-Type", "").partition(";")[0].strip().lower()


def check_url(source, variants, user_agent):
    seen = set()
    chain = []
    try:
        current = site_url(source)
        expected = variants.get(urlsplit(current).path)
        direct = current == expected
        for hop in range(MAX_REDIRECTS + 1):
            if current in seen:
                raise ValueError(f"redirect loop back to {current}")
            seen.add(current)
            status, headers, body = fetch(current, user_agent)
            chain.append(f"{status} {current}")
            if 300 <= status < 400:
                location = headers.get("Location")
                if not location or not location.strip():
                    raise ValueError("redirect has no Location header")
                destination = site_url(urljoin(current, location.strip()))
                if status not in PERMANENT:
                    raise ValueError(f"expected a permanent redirect, got {status} to {destination}")
            elif status == 200:
                if media_type(headers) != "text/html":
                    raise ValueError("target is not served as HTML")
                page = RoutingMetadata()
                page.feed(body)
                if page.outside_head:
                    raise ValueError(f"{', '.join(page.outside_head)} declared outside the HTML head")
                if blocks_search(page.robots + headers.get_all("X-Robots-Tag", [])):
                    raise ValueError("robots directives restrict indexing or link following")
                refreshes = page.refreshes + headers.get_all("Refresh", [])
                if len(page.canonicals) != 1 or page.canonicals[0] not in variants.values():
                    raise ValueError("expected one HTML canonical listed in the sitemap")
                canonical = page.canonicals[0]
                if expected and canonical != expected:
                    raise ValueError(f"expected canonical {expected}, got {canonical}")
                if not refreshes:
                    resource = current.split("?", 1)[0]
                    if resource not in {canonical, canonical + "index.html"}:
                        raise ValueError(f"chain ended at {resource}, expected {canonical}")
                    if current != canonical:
                        chain.append(f"canonical {canonical}")
                    category = "redirect" if hop else "canonical" if current == canonical else "alternate"
                    return category, " -> ".join(chain)
                if len(refreshes) != 1:
                    raise ValueError("multiple refresh redirects")
                match = re.fullmatch(r"\s*0\s*;\s*url\s*=\s*(.+?)\s*", refreshes[0], re.I)
                if not match:
                    raise ValueError("refresh must be an instant redirect with a destination")
                target = match[1].strip("\"'").strip()
                if not target:
                    raise ValueError("refresh has no destination")
                destination = site_url(urljoin(current, target))
                if destination != canonical:
                    raise ValueError("refresh and canonical must point directly to the same target")
                chain.append(f"instant refresh to {destination}")
            else:
                raise ValueError(f"unexpected HTTP {status}")
            if direct:
                raise ValueError(f"canonical sitemap URL redirects to {destination}")
            if urlsplit(destination).scheme != "https":
                raise ValueError(f"redirect does not use HTTPS: {destination}")
            current = destination
        raise ValueError(f"more than {MAX_REDIRECTS} redirects, next target {current}")
    except (HTTPException, OSError, ValueError) as error:
        return "error", f"{' -> '.join(chain) or source}: {error}"


def sitemap_urls(body):
    sitemap = ET.fromstring(body)
    if sitemap.tag != f"{{{SITEMAP_NAMESPACE['s']}}}urlset":
        raise ValueError("sitemap must contain a sitemap-protocol urlset")
    urls = [node.text or "" for node in sitemap.findall("s:url/s:loc", SITEMAP_NAMESPACE)]
    aliases = {page_url(path) for path in REDIRECTS}
    for url in urls:
        parts = urlsplit(url)
        if (
            not url.startswith(f"{SITE_URL}/")
            or not parts.path.endswith("/")
            or parts.query or parts.fragment or url in aliases
        ):
            raise ValueError(f"sitemap contains a non-canonical URL: {url}")
    if not urls or len(urls) != len(set(urls)):
        raise ValueError("sitemap is empty or contains duplicate URLs")
    return set(urls)


def route_variants(canonicals):
    routes = {canonical: canonical for canonical in sorted(canonicals)}
    routes.update({page_url(source): page_url(target) for source, target in REDIRECTS.items()})
    variants = {}
    for url, canonical in routes.items():
        path = urlsplit(url).path
        variants[path] = canonical
        variants[path + "index.html"] = canonical
        if path != "/":
            variants[path.rstrip("/")] = canonical
    return variants


def check_crawl_files(canonicals, user_agent):
    files = {
        "/robots.txt": {"text/plain"},
        "/sitemap.xml": {"application/xml", "text/xml"},
    }
    for path, types in files.items():
        url = SITE_URL + path
        try:
            status, headers, body = fetch(url, user_agent)
            if status != 200 or media_type(headers) not in types:
                raise ValueError(f"expected a direct 200 with {', '.join(sorted(types))}, got HTTP {status} and {media_type(headers)}")
            if path == "/sitemap.xml":
                live = sitemap_urls(body)
                if live != canonicals:
                    raise ValueError(f"sitemap differs from the repository. Missing: {sorted(canonicals - live)}. Extra: {sorted(live - canonicals)}")
            elif body.strip() != (ROOT / "robots.txt").read_text().strip():
                raise ValueError("robots.txt differs from the repository")
            yield "crawl file", f"200 {url}"
        except (ET.ParseError, HTTPException, OSError, ValueError) as error:
            yield "error", f"{url}: {error}"


def check_maintainer_docs(user_agent):
    for name in MAINTAINER_DOCS:
        for extension in ("html", "md"):
            url = f"{SITE_URL}/{name}.{extension}"
            try:
                status, _, _ = fetch(url, user_agent)
                if status not in {404, 410}:
                    raise ValueError(f"maintenance content should be excluded from the Pages build, got HTTP {status}")
                yield "excluded", f"{status} {url}"
            except (HTTPException, OSError, ValueError) as error:
                yield "error", f"{url}: {error}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-agent", default="NativeCubeSEOAudit/2.0")
    parser.add_argument("--url", action="append", help="Trace an exact Search Console example URL. Repeat for more URLs.")
    args = parser.parse_args()
    try:
        canonicals = sitemap_urls((ROOT / "sitemap.xml").read_text())
    except (ET.ParseError, OSError, ValueError) as error:
        parser.error(f"local sitemap.xml: {error}")
    variants = route_variants(canonicals)
    results = []
    cases = args.url
    if not cases:
        results.extend(check_crawl_files(canonicals, args.user_agent))
        results.extend(check_maintainer_docs(args.user_agent))
        cases = [f"{scheme}://{host}{path}" for path in variants for host in HOSTNAMES for scheme in ("https", "http")]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results.extend(pool.map(lambda url: check_url(url, variants, args.user_agent), cases))
    for category, detail in results:
        print(f"{'FAIL' if category == 'error' else 'PASS'} [{category}] {detail}")
    counts = Counter(category for category, _ in results)
    failures = counts["error"]
    summary = ", ".join(f"{count} {category}" for category, count in sorted(counts.items()))
    print(f"Live redirect audit: {len(results) - failures}/{len(results)} passed ({summary})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
