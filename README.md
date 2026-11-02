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

## JSON & YAML Diff Checker

Open `/json-diff/` to compare JSON, JSON-compatible YAML, or one of each entirely
in the browser. Structural comparison ignores object key order, formatting, and
YAML comments, and reports added, removed, and changed values by field path.
Arrays can compare by position, as unordered multisets, or by a unique direct
object field. Kubernetes mode matches multi-document YAML or JSON resource
arrays by API version, kind, namespace, and name.

The page reuses the formatter's header/footer markup, theme stylesheet, and
vendored MIT-licensed js-yaml parser. Inputs are never uploaded or persisted.
File import, individual format selection, formatting, swapping, filtering,
copying, and complete JSON report downloads work locally. Editing inputs or
comparison options invalidates the previous report immediately. Live comparison
refreshes after a short typing pause and can be switched off for manual reviews.
Editable source views highlight the affected lines and values, with matching
gutter markers, live counts, Previous/Next navigation, and Alt+Up/Down shortcuts.
Source locations follow JSON/YAML structure, keyed arrays, aliases, and reordered
Kubernetes resources. Only the visible editor lines are rendered in the highlight
layer so long documents remain practical to navigate.
Results offer side-by-side and unified layouts, syntax coloring, inline value
highlights, and readable Kubernetes resource labels alongside the original
report paths.

The sample picker includes five scenarios each for JSON, YAML, and Kubernetes.
Examples cover API responses, records matched by ID, unordered arrays, type
changes, cross-format equality, Compose configuration, Helm values, aliases,
formatting-only edits, resource identity, ConfigMaps, sidecars, ingress routing,
and CPU/memory quantities. Loading a sample applies its matching options and
input formats, and brings the first changed field into view when needed. Sample
data is maintained in `json-diff/examples.js`.

Each input is limited to 1 MiB, 80 nesting levels, and 50,000 expanded values;
expanded text is capped at 4 MiB and reports at 2,000 changes. Duplicate mapping
keys, recursive aliases, non-finite numbers, and unsafe integers are rejected.
Numbers otherwise use JavaScript precision. Match paths are descriptive report
labels, not JSON Patch operations. Large value previews are shortened; exports
retain complete values.

Run the comparison regression tests:

```sh
node --test scripts/json-diff.test.cjs
```

The page includes indexable JSON and YAML examples, instructions, FAQs, section
navigation, related-tool links, and connected page/application/author/image
structured data. `python3 scripts/seo-audit.py` checks metadata agreement,
canonical URLs, schema relationships, examples, incoming links, and sitemap
dates. Follow the JSON diff section in [`SEARCH_CONSOLE.md`](./SEARCH_CONSOLE.md)
after deployment to inspect indexing and measure search performance.

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

## Cron Schedule Builder

Open `/crontab/` to build and explain cron expressions, preview
upcoming times in an IANA time zone alongside UTC, and export scheduler configuration.
Linux cron, Kubernetes CronJob, GitHub Actions, and AWS EventBridge Scheduler
have separate validation rules and configuration exports. Presets and field
shortcuts help build expressions without memorizing syntax.
The time-zone field accepts manual IANA names and provides a searchable dropdown
with mouse, touch, and keyboard selection.
Choose 1, 2, 5, 10, 25, or 50 upcoming runs; share links retain the selected count.

The builder supports lists, ranges, steps, named months and weekdays, common
Linux/Kubernetes macros, Kubernetes question-mark wildcards, and AWS year,
last-day, nearest-weekday, last-weekday, and nth-weekday fields. It handles
missing and repeated local times, including half-hour clock changes, according
to the documented preview policy for each platform. GitHub's undocumented
fall-back behavior is explicitly modeled as the first occurrence. Actual
execution remains the scheduler's responsibility.

The preview searches eight calendar years after a user-selected UTC instant.
Rare or impossible schedules report partial or empty results separately from
syntax errors. Configuration, CSV downloads, and share links are generated in
the browser. Sharing encodes settings in the URL fragment; there is no backend.
Quartz, seconds fields, rate expressions, and `@reboot` are not supported.

The dependency-free engine is in `crontab/cron.js`; DOM interaction
and exports are in `app.js`, with page markup and responsive styles alongside them.
Run the calendar and timezone regression tests with Node.js 22 or later:

```sh
node --test scripts/crontab.test.cjs
```

The page includes static instructions, crontab examples, a syntax reference,
section navigation, and connected page/application/author/image structured data.
`python3 scripts/seo-audit.py` verifies these SEO relationships and related-tool
links. Follow the crontab checks in [`SEARCH_CONSOLE.md`](./SEARCH_CONSOLE.md)
after deployment to inspect indexing and measure actual search performance.

## Terraform Modules

Open `/terraform-modules/` to explore public AWS Terraform modules
maintained by the native-cube GitHub organization. The catalogue covers
Kubernetes platforms, security, networking, messaging, databases, caching, and
object storage, with direct links to each GitHub repository and Terraform
Registry page.

Module names, descriptions, categories, complete-example paths, and visual
treatments are maintained in `terraform-modules/modules.json`. Registry
versions, release dates, required inputs, Terraform and AWS requirements,
licenses, and GitHub status are synchronized into the same file and used to
generate module cards, permalinks, starter snippets, and structured data.

The catalogue browser logic is maintained in `terraform-modules/app.js` and
embedded into the generated page so category filters and copy actions still work
on enterprise networks that block JavaScript file responses. Run the render
command after changing either the catalogue or browser logic.

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

The weekly `--write` job discovers public, non-archived
`terraform-aws-<name>` repositories in the `native-cube` GitHub organization,
adds an initial catalogue entry from the repository description, and refreshes
its Registry metadata. Repositories are removed from the catalogue when they
are archived. The workflow opens or updates a pull request containing the JSON
configuration and generated HTML; maintainers can refine the generated
presentation fields in that PR. Add `example_path` only when the repository
contains a complete maintained example. GitHub Actions must be permitted to
create pull requests in the repository or organization workflow settings.

To run an update manually, open the repository’s **Actions** tab, select
**Terraform module catalogue**, choose **Run workflow**, enter an optional reason,
and confirm. The action refreshes the catalogue and opens or updates the same
automation pull request.

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
- `http://localhost:8080/json-diff/`
- `http://localhost:8080/crontab/`
- `http://localhost:8080/terraform-modules/`

## Quality and search checks

Run the repository SEO audit locally:

```sh
python3 scripts/seo-audit.py
```

After publishing, check live redirect chains and final canonical destinations:

```sh
python3 scripts/check-redirects.py
```

The separate `Live redirect checks` workflow checks production weekly and on
manual runs. The local SEO audit also checks internal canonical links and
fragments, distinct titles and descriptions, structured-data URLs, and sitemap
freshness for the generated Terraform catalogue.

The `Lighthouse and SEO` GitHub Actions workflow audits every canonical page
on pull requests and pushes to `main`. It enforces minimum performance,
accessibility, best-practices, and SEO scores together with lab thresholds for
Largest Contentful Paint, cumulative layout shift, and total blocking time. It
also validates HTML and checks internal fragments and external links.

Google Search Console requires account-issued ownership verification. Follow
[`SEARCH_CONSOLE.md`](./SEARCH_CONSOLE.md) to verify a Domain property, retain
the unmodified verification file, submit the sitemap, and distinguish expected
redirect exclusions from actual redirect errors.
