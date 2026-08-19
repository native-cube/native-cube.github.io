# Native Cube

A collection of small, static cloud-native tools published with GitHub Pages.

## Kubernetes Manifest Builder

Open `/k8s-manifest-builder/` to configure an `apps/v1` Deployment,
StatefulSet, or DaemonSet and export it as YAML or JSON.

The form covers common workload, container, probe, resource, storage,
scheduling, security, lifecycle, and rollout fields. The **Additional manifest
fields** editor accepts a JSON object that is deep-merged into the generated
resource for API fields not represented directly in the form.

## Helm Chart Builder

Open `/helm-chart-builder/` to configure a Deployment, StatefulSet, or DaemonSet
and generate a reusable Helm chart entirely in the browser. The exported ZIP
contains `Chart.yaml`, documented defaults, `values.schema.json`, namespaced
helpers, workload and optional component templates, release notes, a connection
test, and a generated README.

Service, Ingress, and ServiceAccount annotations accept one `key=value` pair per
line and are included in the generated values, template output, and manifest
preview.

The generated chart preview refreshes automatically two seconds after form
changes, while the Generate button remains available for immediate updates.
The page also includes a local Helm workflow for unpacking, linting, rendering,
installing, upgrading, inspecting, testing, and removing the generated chart.

The builder supports stable chart API `v2` and experimental chart API `v3`.
Version `v2` remains the base-example default. Version `v3` requires Helm 4,
`HELM_EXPERIMENTAL_CHART_V3=1`, and a Helm release whose experimental chart-v3
implementation supports the operation being used.

Ingress generation supports both name-based virtual hosts and hostless rules.
Disable **Include host** to omit `spec.rules[].host` and match requests for any
host handled by the selected Ingress controller.

Use **Generate base example** for a ready-to-download NGINX chart. The tool
provides an equivalent rendered-manifest preview; use the displayed `helm lint`
and `helm template` commands for authoritative Helm rendering and validation.

## Argo CD ApplicationSet Studio

Open `/argocd-applicationset-studio/` to simulate an Argo CD ApplicationSet and
inspect the generated Application fleet entirely in the browser. The studio
supports List, mock Cluster, mock Git directory/file, Matrix, and Merge
generators. Generators that normally call an SCM provider, pull request API,
decision resource, or plugin can use explicit local `generatorResults` data.

The preview includes a searchable Application inventory, generator and parameter
traces, a destination-oriented fleet map, duplicate and template diagnostics,
sync-policy risk warnings, and multi-document YAML export. Optional AppProject
manifests validate generated repository and destination boundaries. Save a fleet
baseline to review added, removed, and changed Applications after an edit.
Four curated examples demonstrate regional Matrix generation, Git directory
discovery, Merge overrides, and locally mocked SCM provider results.

The tool implements a documented subset of Go template and Sprig behavior and
labels mocked or approximated results. It never contacts Argo CD, Kubernetes,
Git, or an SCM provider, and generated output should be verified with the
ApplicationSet controller before production use.

The Studio ships one embedded v1 browser runtime so it also works on enterprise
networks that block JavaScript file responses. It includes js-yaml 5.2.2. After
changing `app.js` or upgrading the vendored parser, refresh and verify the page:

```sh
python3 scripts/embed-applicationset-studio-runtime.py --write
python3 scripts/embed-applicationset-studio-runtime.py --check
```

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

## Kubernetes RBAC Explorer

Open `/kubernetes-rbac-explorer/` to turn Kubernetes Roles and bindings into
an effective access map. The tool resolves subject-to-role grant paths, answers
permission questions, highlights review-worthy access, compares policy
snapshots, generates narrowly scoped RBAC drafts, and exports a Markdown review.

The explorer accepts multi-document YAML, JSON arrays, and Kubernetes `List`
objects. Parsing and analysis stay in the browser. Secret objects are rejected,
and users should never provide a kubeconfig, token, or other credentials. YAML
input uses the existing vendored `js-yaml` 4.1.0 bundle.

The random sample library demonstrates namespace read-only access, deployment
operations, sensitive cluster access, RBAC administration, aggregated
ClusterRoles, and incomplete policy exports. Consecutive sample selections do
not repeat the same scenario.

## Terraform Modules

Open `/terraform-modules/` to explore public AWS Terraform modules
maintained by the native-cube GitHub organization. The catalogue covers Amazon
EKS, EKS Auto Mode, managed node groups, Fargate profiles, KMS, and VPC Flow
Logs, with direct links to each GitHub repository and Terraform Registry page.

Module names, descriptions, categories, complete-example paths, and visual
treatments are maintained in `terraform-modules/modules.json`. Registry
versions, release dates, required inputs, Terraform and AWS requirements,
licenses, and GitHub status are synchronized into the same file and used to
generate module cards, permalinks, starter snippets, and structured data.

Editors can use `terraform-modules/modules.schema.json` for autocomplete. CI
validates the catalogue against that schema and performs duplicate-name and
generated-output checks in the synchronization script.

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
`terraform-aws-<name>` repository and Registry module, then run `--write`. Add
`example_path` only when the repository contains a complete maintained example.
The weekly catalogue workflow refreshes metadata and opens or updates a pull
request when anything changes. GitHub Actions must be permitted to create pull
requests in the repository or organization workflow settings.

The dedicated social card is maintained as an editable SVG. On macOS, regenerate
its required 1200×630 PNG with:

```sh
sh scripts/render-social-card.sh
```

Other social cards can use the same renderer by supplying both paths, for example:

```sh
sh scripts/render-social-card.sh \
  assets/social/kubernetes-rbac-explorer.svg \
  assets/social/kubernetes-rbac-explorer.png
```

## To preview locally

```sh
python3 -m http.server 8080
```

- `http://localhost:8080/k8s-manifest-builder/`
- `http://localhost:8080/helm-chart-builder/`
- `http://localhost:8080/argocd-applicationset-studio/`
- `http://localhost:8080/kubernetes-rbac-explorer/`
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
Largest Contentful Paint, cumulative layout shift, and total blocking time. It
also validates HTML and checks internal fragments and external links.

Google Search Console requires account-issued ownership verification. Follow
[`SEARCH_CONSOLE.md`](./SEARCH_CONSOLE.md) to add the URL-prefix property,
install the unmodified verification file, submit the sitemap, and request
indexing for each canonical page.
