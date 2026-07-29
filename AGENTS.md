# Repository Guidelines

## Project Structure & Module Organization

This repository is a dependency-free static site deployed with GitHub Pages.
The root `index.html` is the Native Cube landing page and contains its styles
inline. The Kubernetes tool lives in `k8s-manifest-builder/`: `index.html`
defines the form and accessible markup, `styles.css` owns its responsive visual
design, and `app.js` builds, validates, formats, copies, and downloads manifests.
`visual-subnet-calculator/` follows the same three-file structure for IPv4
planning. `README.md` provides the user-facing overview. There are no generated
files, asset directory, or automated tests.

## Build, Test, and Development Commands

Run commands from the repository root:

```sh
python3 -m http.server 8080
```

This serves the unbuilt source locally. Open `http://localhost:8080/` for the
landing page and `/k8s-manifest-builder/` for the tool. No dependency
installation or build command is required. Before committing, run
`git diff --check` to catch whitespace errors.

## Coding Style & Naming Conventions

Use two-space indentation in HTML, CSS, and JavaScript. Follow the established
JavaScript style: strict mode, `const`/`let`, semicolons, double-quoted strings,
trailing commas in multiline structures, and small camelCase functions. Use
kebab-case for CSS classes, HTML filenames, and feature directories; keep DOM
IDs descriptive and consistent with the corresponding form field. Reuse CSS
custom properties from `:root` instead of introducing duplicate color values.
Preserve semantic HTML, labels, keyboard focus states, and ARIA attributes.
There is no configured formatter or linter, so match adjacent code.

## Testing Guidelines

Testing is manual. Verify both pages at desktop and narrow viewport widths.
Exercise Deployment and StatefulSet output, YAML/JSON switching, validation,
reset, copy, download, repeatable rows, advanced-field merging, and section
navigation. For subnet changes, test CIDR validation, split/join, cloud address
policies, notes, sharing, and JSON export. Confirm the browser console stays
clean and include focused regression steps in the pull request.

## Commit & Pull Request Guidelines

Recent commits use brief, lowercase, imperative summaries such as `fix preview`
and `update path`. Keep each commit focused and explain non-obvious behavior in
the body. Pull requests should summarize the change, list manual test results,
link relevant issues, and include before/after screenshots for visual changes.
Call out changes that affect generated Kubernetes fields or browser support.

## Security & Configuration

Keep the site fully client-side. Do not commit credentials, cluster data, or
private registry tokens. Treat generated YAML/JSON as a draft: contributors
should validate security-sensitive Kubernetes settings before recommending
production use.
