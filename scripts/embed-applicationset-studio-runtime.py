#!/usr/bin/env python3

import argparse
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
PAGE_PATH = ROOT / "argocd-applicationset-studio/index.html"
RUNTIMES = {
    "yaml-runtime-v1": ROOT / "argocd-applicationset-studio/vendor/js-yaml-5.2.2.umd.min.js",
    "applicationset-studio-runtime-v1": ROOT / "argocd-applicationset-studio/app.js",
}


def embed_runtime(page, runtime_id, source):
    opening = f'<script id="{runtime_id}">\n'.encode()
    closing = b"\n    </script>"
    opening_index = page.find(opening)
    if opening_index < 0:
        raise RuntimeError(f"missing {runtime_id} opening tag")
    content_index = opening_index + len(opening)
    closing_index = page.find(closing, content_index)
    if closing_index < 0:
        raise RuntimeError(f"missing {runtime_id} closing tag")
    if b"</script" in source.lower():
        raise RuntimeError(f"{runtime_id} contains an unsafe script terminator")
    try:
        source_text = source.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError(f"{runtime_id} is not valid UTF-8") from error
    forbidden = sorted(
        {
            codepoint
            for codepoint in map(ord, source_text)
            if (codepoint < 32 and codepoint not in {9, 10, 13})
            or 127 <= codepoint <= 159
        }
    )
    if forbidden:
        values = ", ".join(f"U+{codepoint:04X}" for codepoint in forbidden)
        raise RuntimeError(f"{runtime_id} contains HTML-forbidden code points: {values}")
    return page[:content_index] + source.rstrip(b"\r\n") + page[closing_index:]


def render_page():
    page = PAGE_PATH.read_bytes()
    for runtime_id, source_path in RUNTIMES.items():
        page = embed_runtime(page, runtime_id, source_path.read_bytes())
    return page


def main():
    parser = argparse.ArgumentParser(description="Maintain the embedded ApplicationSet Studio v1 runtime.")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true", help="Embed the current runtime sources into the page.")
    action.add_argument("--check", action="store_true", help="Verify that the embedded runtime matches its sources.")
    args = parser.parse_args()

    try:
        rendered = render_page()
    except (OSError, RuntimeError) as error:
        print(f"ApplicationSet Studio runtime error: {error}", file=sys.stderr)
        return 1

    current = PAGE_PATH.read_bytes()
    if args.check:
        if current != rendered:
            print("ApplicationSet Studio runtime is out of date. Run with --write.", file=sys.stderr)
            return 1
        print("ApplicationSet Studio v1 runtime is current.")
        return 0

    PAGE_PATH.write_bytes(rendered)
    print("Embedded the ApplicationSet Studio v1 runtime.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
