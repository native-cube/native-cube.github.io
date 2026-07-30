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

## To preview locally

```sh
python3 -m http.server 8080
```

- `http://localhost:8080/k8s-manifest-builder/`
- `http://localhost:8080/visual-subnet-calculator/`
- `http://localhost:8080/yaml-formatter/`

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
