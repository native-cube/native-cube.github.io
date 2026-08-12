#!/usr/bin/env python3

import argparse
from copy import deepcopy
from datetime import datetime, timezone
from html import escape
from pathlib import Path
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
CATALOGUE_PATH = ROOT / "terraform-modules/modules.json"
PAGE_PATH = ROOT / "terraform-modules/index.html"
JSON_LD_START = "<!-- MODULE_JSON_LD_START -->"
JSON_LD_END = "<!-- MODULE_JSON_LD_END -->"
CARDS_START = "<!-- MODULE_CARDS_START -->"
CARDS_END = "<!-- MODULE_CARDS_END -->"
COUNT_START = "<!-- MODULE_COUNT_START -->"
COUNT_END = "<!-- MODULE_COUNT_END -->"
THEMES = {"auto", "eks", "fargate", "kms", "network", "nodes"}
ICONS = {
    "bolt": '<path d="M13.5 2.8 6.8 13h5l-1.3 8.2L17.2 11h-5l1.3-8.2Z" />',
    "cluster": (
        '<path d="m12 3 7.5 4.3v8.8L12 20.5 4.5 16V7.4L12 3Z" />\n'
        '                  <path d="m8.5 9.1 3.5-2 3.5 2v4L12 15l-3.5-2V9.1Z" />'
    ),
    "key": '<circle cx="8" cy="12" r="4" />\n                  <path d="M12 12h8M17 12v3M20 12v2" />',
    "layers": '<path d="m12 3 8 4-8 4-8-4 8-4Z" />\n                  <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />',
    "network": (
        '<circle cx="5" cy="12" r="2.5" />\n'
        '                  <circle cx="19" cy="6" r="2.5" />\n'
        '                  <circle cx="19" cy="18" r="2.5" />\n'
        '                  <path d="m7.3 11 9.4-4M7.3 13l9.4 4" />'
    ),
    "nodes": (
        '<rect x="3.5" y="4" width="7" height="6" rx="1.5" />\n'
        '                  <rect x="13.5" y="4" width="7" height="6" rx="1.5" />\n'
        '                  <rect x="8.5" y="14" width="7" height="6" rx="1.5" />\n'
        '                  <path d="M7 10v2h10v-2M12 12v2" />'
    ),
}
MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


class SyncError(RuntimeError):
    pass


def load_catalogue():
    try:
        return json.loads(CATALOGUE_PATH.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SyncError(f"cannot read {CATALOGUE_PATH.relative_to(ROOT)}: {error}") from error


def validate_catalogue(catalogue):
    if catalogue.get("schema_version") != 1:
        raise SyncError("modules.json schema_version must be 1")

    namespace = catalogue.get("namespace")
    provider = catalogue.get("provider")
    modules = catalogue.get("modules")
    if not namespace or not provider or not isinstance(modules, list) or not modules:
        raise SyncError("modules.json must define namespace, provider, and modules")

    names = []
    for module in modules:
        name = module.get("name")
        names.append(name)
        for field in ("name", "title", "category", "theme", "icon", "summary"):
            if not module.get(field):
                raise SyncError(f"module {name or '<unknown>'} is missing {field}")
        if module["theme"] not in THEMES:
            raise SyncError(f"module {name} uses unsupported theme {module['theme']}")
        if module["icon"] not in ICONS:
            raise SyncError(f"module {name} uses unsupported icon {module['icon']}")
        if not isinstance(module.get("metadata"), dict):
            raise SyncError(f"module {name} has no synchronized metadata")

    if len(names) != len(set(names)):
        raise SyncError("module names must be unique")


def request_json(url):
    headers = {
        "Accept": "application/vnd.github+json, application/json",
        "User-Agent": "native-cube-module-catalogue/1.0",
    }
    github_token = os.environ.get("GITHUB_TOKEN")
    if github_token and "api.github.com" in url:
        headers["Authorization"] = f"Bearer {github_token}"

    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        raise SyncError(f"{url} returned HTTP {error.code}") from error
    except URLError as error:
        raise SyncError(f"could not reach {url}: {error.reason}") from error
    except json.JSONDecodeError as error:
        raise SyncError(f"{url} did not return valid JSON") from error


def terraform_requirement(readme):
    match = re.search(r"\[terraform\][^|\n]*\|\s*([^|\n]+)", readme or "", re.IGNORECASE)
    if not match:
        raise SyncError("could not determine the Terraform version requirement")
    return match.group(1).strip()


def provider_requirement(module_payload, provider):
    dependencies = module_payload.get("root", {}).get("provider_dependencies", [])
    for dependency in dependencies:
        if dependency.get("name") == provider:
            return dependency.get("version", "").strip()
    raise SyncError(f"could not determine the {provider} provider requirement")


def live_catalogue(catalogue):
    updated = deepcopy(catalogue)
    namespace = updated["namespace"]
    provider = updated["provider"]
    expected_repositories = {
        f"terraform-{provider}-{module['name']}" for module in updated["modules"]
    }
    repositories = request_json(
        f"https://api.github.com/orgs/{namespace}/repos?per_page=100&type=public"
    )
    terraform_repositories = {
        repository["name"]: repository
        for repository in repositories
        if repository.get("name", "").startswith(f"terraform-{provider}-")
    }
    actual_repositories = set(terraform_repositories)
    if actual_repositories != expected_repositories:
        missing = sorted(expected_repositories - actual_repositories)
        unexpected = sorted(actual_repositories - expected_repositories)
        details = []
        if missing:
            details.append(f"missing from GitHub: {', '.join(missing)}")
        if unexpected:
            details.append(f"not catalogued: {', '.join(unexpected)}")
        raise SyncError("GitHub module catalogue drift: " + "; ".join(details))

    for module in updated["modules"]:
        name = module["name"]
        repository_name = f"terraform-{provider}-{name}"
        repository = terraform_repositories[repository_name]
        payload = request_json(
            f"https://registry.terraform.io/v1/modules/{namespace}/{name}/{provider}"
        )
        if payload.get("name") != name or payload.get("provider") != provider:
            raise SyncError(f"Registry returned unexpected metadata for {name}")

        required_inputs = sorted(
            (
                {
                    "name": item.get("name", ""),
                    "type": item.get("type", ""),
                    "description": item.get("description", ""),
                }
                for item in payload.get("root", {}).get("inputs", [])
                if item.get("required") is True
            ),
            key=lambda item: item["name"],
        )
        module["metadata"] = {
            "version": payload.get("version"),
            "published_at": payload.get("published_at"),
            "terraform_requirement": terraform_requirement(
                payload.get("root", {}).get("readme", "")
            ),
            "provider_requirement": provider_requirement(payload, provider),
            "required_inputs": required_inputs,
            "archived": bool(repository.get("archived")),
            "deprecated": bool(payload.get("deprecation")),
            "pushed_at": repository.get("pushed_at"),
            "license": (repository.get("license") or {}).get("spdx_id"),
        }

    updated["synced_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
    return updated


def module_urls(catalogue, module):
    namespace = catalogue["namespace"]
    provider = catalogue["provider"]
    name = module["name"]
    return {
        "github": f"https://github.com/{namespace}/terraform-{provider}-{name}",
        "registry": f"https://registry.terraform.io/modules/{namespace}/{name}/{provider}/latest",
        "source": f"{namespace}/{name}/{provider}",
    }


def module_example(module, source):
    metadata = module["metadata"]
    required_count = len(metadata["required_inputs"])
    if required_count == 0:
        required_comment = "  # no required variables"
    else:
        noun = "variable" if required_count == 1 else "variables"
        required_comment = f"  # insert the {required_count} required {noun} here"
    return "\n".join(
        (
            f'module "{module["name"]}" {{',
            f'  source  = "{source}"',
            f'  version = "{metadata["version"]}"',
            "",
            required_comment,
            "}",
        )
    )


def parse_timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def display_date(value):
    date = parse_timestamp(value)
    return f"{date.day} {MONTHS[date.month - 1]} {date.year}"


def render_json_ld(catalogue):
    site_url = "https://native-cube.github.io/terraform-modules/"
    items = []
    for position, module in enumerate(catalogue["modules"], start=1):
        urls = module_urls(catalogue, module)
        items.append(
            {
                "@type": "ListItem",
                "position": position,
                "item": {
                    "@type": "SoftwareSourceCode",
                    "name": module["title"],
                    "description": module["summary"],
                    "url": urls["registry"],
                    "codeRepository": urls["github"],
                    "version": module["metadata"]["version"],
                    "programmingLanguage": "HCL",
                    "runtimePlatform": "Amazon Web Services",
                },
            }
        )

    payload = [
        {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "@id": f"{site_url}#webpage",
            "url": site_url,
            "name": "Native Cube AWS Terraform Modules",
            "description": f"A catalogue of {len(items)} public AWS Terraform modules maintained by Native Cube.",
            "dateModified": catalogue["synced_at"],
            "isPartOf": {"@id": "https://native-cube.github.io/#website"},
            "breadcrumb": {"@id": f"{site_url}#breadcrumb"},
            "mainEntity": {"@id": f"{site_url}#modules"},
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "@id": f"{site_url}#breadcrumb",
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": 1,
                    "name": "Native Cube",
                    "item": "https://native-cube.github.io/",
                },
                {
                    "@type": "ListItem",
                    "position": 2,
                    "name": "Terraform Modules",
                    "item": site_url,
                },
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "@id": f"{site_url}#modules",
            "name": "Native Cube Terraform modules",
            "numberOfItems": len(items),
            "itemListElement": items,
        },
    ]
    encoded = json.dumps(payload, indent=2, ensure_ascii=False)
    indented = "\n".join(f"      {line}" for line in encoded.splitlines())
    return (
        '    <script type="application/ld+json">\n'
        f"{indented}\n"
        "    </script>"
    )


def render_required_inputs(required_inputs):
    if not required_inputs:
        return '                <p class="no-required-inputs">No required inputs. Configure optional variables as needed.</p>'

    lines = ['                <ul class="required-inputs">']
    for item in required_inputs:
        lines.extend(
            (
                "                  <li>",
                f'                    <code>{escape(item["name"])}</code>',
                f'                    <span>{escape(item["type"])}</span>',
                "                  </li>",
            )
        )
    lines.append("                </ul>")
    return "\n".join(lines)


def render_card(catalogue, module):
    metadata = module["metadata"]
    urls = module_urls(catalogue, module)
    required_count = len(metadata["required_inputs"])
    required_label = "No required" if required_count == 0 else str(required_count)
    required_detail = "inputs" if required_count != 1 else "input"
    status = "Deprecated" if metadata["deprecated"] else "Archived" if metadata["archived"] else "Active"
    status_class = " status-badge--warning" if status != "Active" else ""
    example = module_example(module, urls["source"])
    input_markup = render_required_inputs(metadata["required_inputs"])
    icon = ICONS[module["icon"]]
    published_date = metadata["published_at"].split("T", 1)[0]

    return f'''          <article class="module-card module-card--{escape(module["theme"])}">
            <div class="card-topline">
              <span class="module-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  {icon}
                </svg>
              </span>
              <span class="module-type">{escape(module["category"])}</span>
              <span class="status-badge{status_class}"><i></i> {status}</span>
            </div>
            <h3>{escape(module["title"])}</h3>
            <p class="module-description">{escape(module["summary"])}</p>
            <dl class="module-facts" aria-label="{escape(module["title"])} module metadata">
              <div>
                <dt>Latest</dt>
                <dd>v{escape(metadata["version"])}</dd>
              </div>
              <div>
                <dt>Required</dt>
                <dd>{required_label} {required_detail}</dd>
              </div>
              <div>
                <dt>Released</dt>
                <dd><time datetime="{published_date}">{display_date(metadata["published_at"])}</time></dd>
              </div>
            </dl>
            <p class="module-requirements">
              <span>Terraform {escape(metadata["terraform_requirement"])}</span>
              <span>AWS {escape(metadata["provider_requirement"])}</span>
            </p>
            <div class="source-address">
              <code>{escape(urls["source"])}</code>
              <button
                type="button"
                data-module-copy
                data-module="{escape(module["name"])}"
                data-title="{escape(module["title"])}"
                data-source="{escape(urls["source"])}"
                data-version="{escape(metadata["version"])}"
                data-required="{required_count}"
                aria-label="Copy {escape(module["title"])} module block"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="10" height="11" rx="2" />
                  <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" />
                </svg>
                <span>Copy module block</span>
              </button>
            </div>
            <details class="usage-disclosure">
              <summary>
                <span>View usage and required inputs</span>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
              </summary>
              <div class="usage-content">
                <h4>Module block</h4>
                <pre><code>{escape(example)}</code></pre>
                <h4>Required inputs</h4>
{input_markup}
              </div>
            </details>
            <div class="card-links">
              <a href="{urls["registry"]}" target="_blank" rel="noreferrer">
                Registry docs <span aria-hidden="true">↗</span>
              </a>
              <a href="{urls["github"]}" target="_blank" rel="noreferrer">
                GitHub source <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>'''


def render_cards(catalogue):
    synced_date = catalogue["synced_at"].split("T", 1)[0]
    cards = "\n\n".join(render_card(catalogue, module) for module in catalogue["modules"])
    return f'''        <p class="catalogue-sync">
          Registry and GitHub metadata synchronized
          <time datetime="{synced_date}">{display_date(catalogue["synced_at"])}</time>.
        </p>
        <div class="module-grid">
{cards}
        </div>'''


def replace_region(text, start_marker, end_marker, rendered, end_indent):
    start = text.find(start_marker)
    end = text.find(end_marker)
    if start < 0 or end < 0 or end <= start:
        raise SyncError(f"missing generated region markers: {start_marker}, {end_marker}")
    content_start = start + len(start_marker)
    return text[:content_start] + "\n" + rendered + "\n" + end_indent + text[end:]


def replace_inline(text, start_marker, end_marker, rendered):
    start = text.find(start_marker)
    end = text.find(end_marker)
    if start < 0 or end < 0 or end <= start:
        raise SyncError(f"missing generated region markers: {start_marker}, {end_marker}")
    content_start = start + len(start_marker)
    return text[:content_start] + rendered + text[end:]


def rendered_page(catalogue):
    page = PAGE_PATH.read_text()
    page = replace_region(
        page, JSON_LD_START, JSON_LD_END, render_json_ld(catalogue), "    "
    )
    page = replace_region(page, CARDS_START, CARDS_END, render_cards(catalogue), "        ")
    page = replace_inline(
        page, COUNT_START, COUNT_END, f"{len(catalogue['modules']):02d}"
    )
    return page


def write_catalogue(catalogue):
    CATALOGUE_PATH.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n")


def write_page(catalogue):
    PAGE_PATH.write_text(rendered_page(catalogue))


def metadata_drift(stored, live):
    differences = []
    live_by_name = {module["name"]: module for module in live["modules"]}
    for module in stored["modules"]:
        live_module = live_by_name[module["name"]]
        if module["metadata"] != live_module["metadata"]:
            differences.append(module["name"])
    return differences


def check(catalogue):
    live = live_catalogue(catalogue)
    differences = metadata_drift(catalogue, live)
    if differences:
        raise SyncError(
            "Registry or GitHub metadata changed for "
            + ", ".join(differences)
            + "; run scripts/sync-terraform-modules.py --write"
        )
    expected_page = rendered_page(catalogue)
    if PAGE_PATH.read_text() != expected_page:
        raise SyncError(
            "terraform-modules/index.html is not generated from modules.json; "
            "run scripts/sync-terraform-modules.py --render"
        )


def main():
    parser = argparse.ArgumentParser(
        description="Synchronize and render the Native Cube Terraform module catalogue."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="refresh metadata and render HTML")
    mode.add_argument("--check", action="store_true", help="fail when metadata or HTML has drifted")
    mode.add_argument("--render", action="store_true", help="render HTML from local modules.json")
    args = parser.parse_args()

    try:
        catalogue = load_catalogue()
        validate_catalogue(catalogue)
        if args.write:
            catalogue = live_catalogue(catalogue)
            write_catalogue(catalogue)
            write_page(catalogue)
            print(f"Updated {CATALOGUE_PATH.relative_to(ROOT)} and {PAGE_PATH.relative_to(ROOT)}")
        elif args.render:
            write_page(catalogue)
            print(f"Rendered {PAGE_PATH.relative_to(ROOT)}")
        else:
            check(catalogue)
            print("Terraform module catalogue is synchronized and generated correctly")
    except SyncError as error:
        print(f"Terraform module sync failed: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
