# Native Cube

A collection of small, static cloud-native tools published with GitHub Pages.

## Kubernetes Manifest Builder

Open `/k8s-manifest-builder/` to configure an `apps/v1` Deployment,
StatefulSet, or DaemonSet and export it as YAML or JSON.

The form covers common workload, container, probe, resource, storage,
scheduling, security, lifecycle, and rollout fields. The **Additional manifest
fields** editor accepts a JSON object that is deep-merged into the generated
resource for API fields not represented directly in the form.


## Visual Subnet Calculator

Open `/visual-subnet-calculator/` to split an IPv4 CIDR block into a visual,
editable plan. Subnets can be split, joined, color-coded, annotated, exported
as JSON, or shared through a URL. Standard IPv4, AWS VPC, and Azure VNet
address reservation policies are supported.

## YAML & JSON Formatter

Open `/yaml-formatter/` to validate, format, and convert YAML or JSON
entirely in the browser. The editor auto-detects the input format, reports
syntax errors with line and column details, supports multi-document YAML, and
can copy or download the formatted result.

The shorter `/json-formatter/` alias redirects to this tool.

YAML parsing and serialization use the vendored `js-yaml` 4.1.0 browser
bundle, distributed under the MIT license included with the tool.

## Terraform Modules

Open `/terraform-modules/` to explore public AWS Terraform modules
maintained by the native-cube GitHub organization. The catalogue covers Amazon
EKS, EKS Auto Mode, managed node groups, Fargate profiles, KMS, and VPC Flow
Logs, with direct links to each GitHub repository and Terraform Registry page.

Module names, descriptions, categories, and visual treatments are maintained in
`terraform-modules/modules.json`. Registry versions, release dates, required
inputs, Terraform and AWS requirements, and GitHub status are synchronized into
the same file and used to generate the module cards and structured data.

Refresh live metadata and regenerate the page:

```sh
python3 scripts/sync-terraform-modules.py --write
```

Regenerate from local catalogue data without network access, or verify live data
and committed HTML without changing files:

```sh
python3 scripts/sync-terraform-modules.py --render
python3 scripts/sync-terraform-modules.py --check
```

To add a module, add its curated entry to `modules.json`, publish the matching
`terraform-aws-<name>` repository and Registry module, then run `--write`. The
weekly catalogue workflow also reports Registry, GitHub, or generated-page drift.

The dedicated social card is maintained as an editable SVG. On macOS, regenerate
its required 1200×630 PNG with:

```sh
sh scripts/render-social-card.sh
```

## To preview locally

```sh
python3 -m http.server 8080
```

- `http://localhost:8080/k8s-manifest-builder/`
- `http://localhost:8080/visual-subnet-calculator/`
- `http://localhost:8080/yaml-formatter/`
- `http://localhost:8080/terraform-modules/`

## Quality and search checks

Run the repository SEO audit locally:

```sh
python3 scripts/seo-audit.py
```

The `Lighthouse and SEO` GitHub Actions workflow audits every canonical page
on pull requests and pushes to `main`. It enforces minimum performance,
accessibility, best-practices, and SEO scores together with lab thresholds for
Largest Contentful Paint, cumulative layout shift, and total blocking time.

Google Search Console requires account-issued ownership verification. Follow
[`SEARCH_CONSOLE.md`](./SEARCH_CONSOLE.md) to add the URL-prefix property,
install the unmodified verification file, submit the sitemap, and request
indexing for each canonical page.
