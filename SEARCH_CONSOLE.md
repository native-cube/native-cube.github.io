# Google Search Console setup

The repository is ready for Google Search Console: every indexable page has one
self-referencing `https://native-cube.com/.../` canonical, explicit index/follow
directives, matching Open Graph and structured-data URLs, and an entry in
`sitemap.xml`. `robots.txt` advertises that sitemap. The duplicate
`/json-formatter/` alias points directly to `/yaml-formatter/` through an instant
meta refresh and a canonical link; it is excluded from the sitemap and navigation.
The cron tool is published only at `/crontab/`, with the same canonical URL in
its page metadata, structured data, navigation, and sitemap.

Ownership verification must be completed by a Google account with access to
Search Console. The verification value is account-issued and must not be
invented or replaced with a placeholder.

## Verify the property

1. Open [Google Search Console](https://search.google.com/search-console/).
2. Add a **Domain property** named `native-cube.com` (without `https://` or a
   trailing slash). This covers the apex, `www`, HTTP, HTTPS, and every path.
3. Copy the TXT verification record supplied by Search Console into the DNS
   zone at the domain registrar, then select **Verify**. Keep that DNS record in
   place so ownership remains valid.
4. Optionally retain the `https://native-cube.com/` URL-prefix property for
   protocol-specific reporting. Its existing HTML verification file must stay
   at the repository root.

## Submit and inspect

1. Open **Sitemaps** for the verified property.
2. Submit `https://native-cube.com/sitemap.xml`.
3. Use **URL inspection** for these canonical URLs and request indexing:
   - `https://native-cube.com/`
   - `https://native-cube.com/k8s-manifest-builder/`
   - `https://native-cube.com/helm-chart-builder/`
   - `https://native-cube.com/argocd-applicationset-studio/`
   - `https://native-cube.com/kubernetes-rbac-explorer/`
   - `https://native-cube.com/visual-subnet-calculator/`
   - `https://native-cube.com/yaml-formatter/`
   - `https://native-cube.com/json-diff/`
   - `https://native-cube.com/crontab/`
   - `https://native-cube.com/timestamp-converter/`
   - `https://native-cube.com/terraform-modules/`
4. Do not submit `/json-formatter/`; it is a redirect alias.

## Confirm Google's selected canonical

After the updated site is deployed, inspect each sitemap URL in Search Console.
The **User-declared canonical** and **Google-selected canonical** should both use
the exact `https://native-cube.com/.../` URL shown above. If Google reports an
older `native-cube.github.io`, HTTP, `www`, or `index.html` variant, run **Test
live URL** and request indexing for the canonical URL. Redirects and sitemap
processing can take time to be recrawled; do not add duplicate variants to the
sitemap.

The account owner can provide the downloaded verification file to a
contributor for placement, but should not share Google credentials.

## Redirect exclusions versus redirect failures

In **Page indexing**, use the submitted sitemap filter to check the URLs we
intend Google to index. Each entry should return HTML with a direct HTTP 200 and
declare its own canonical. Investigate any submitted URL marked **Page with
redirect**.

In the unfiltered report, **Page with redirect** is expected for working HTTP,
`www`, old GitHub Pages, slashless, and `/json-formatter/` variants. Inspect the
canonical destination to check its indexing status. GitHub Pages also serves
`/index.html` duplicates with HTTP 200 and the clean directory URL as canonical.
Those can appear as **Alternate page with proper canonical tag**.

A **Redirect error** means Google could not follow a chain because of a loop,
excessive redirects, an invalid or empty destination, or an overly long URL.
Copy the exact affected URL from the report, including any query string,
and record the last crawl date. Trace that URL before changing its routing.

These distinctions are documented in Google's
[Page indexing report help](https://support.google.com/webmasters/answer/7440203).

## Check the deployed site

Run the dependency-free live audit after deployment:

```sh
python3 scripts/check-redirects.py
```

The audit checks the published sitemap and robots file against the repository,
then tests directory, slashless, and `index.html` paths across the apex, `www`,
and the old GitHub Pages hostname on both HTTP and HTTPS. It also checks the
formatter alias and that repository guidance is excluded from the Pages build.

| Audit result | Meaning |
| --- | --- |
| `canonical` | A sitemap URL returns HTML with a direct indexable 200. |
| `redirect` | A permanent chain ends at the expected page or its canonicalized `index.html` equivalent. |
| `alternate` | A duplicate URL returns 200 and declares the expected canonical. |
| `error` | The chain or its destination failed a check. The detail includes the observed hops. |

The **Live redirect checks** workflow runs weekly and on demand. Run it after
GitHub Pages publishes the source changes to check the new deployment.

Trace specific report examples without running the full audit. Repeat `--url`
to check more than one source.

```sh
python3 scripts/check-redirects.py \
  --url 'https://www.native-cube.com/json-formatter' \
  --url 'https://native-cube.com/yaml-formatter/index.html'
```

An optional user agent helps investigate response differences:

```sh
python3 scripts/check-redirects.py --user-agent Googlebot
```

Use the user-agent option to compare responses. Search Console’s **Test live
URL** shows the result of Google’s own fetch.

Public HTTP checks on 25 November 2026 found direct 200 responses for all 11
sitemap URLs and successful chains for the known redirects. The sitemap and
robots file matched the repository. GitHub Pages also served `AGENTS.html` and
`SEARCH_CONSOLE.html` with their own canonicals. `_config.yml` excludes those
source documents, the README, and maintenance scripts from subsequent builds.

## Hosting settings and redirect aliases

Keep **Settings → Pages → Custom domain** set to `native-cube.com` and
**Enforce HTTPS** enabled. The repository's `CNAME` file does not by itself
enforce HTTPS or configure DNS. Both the apex and `www` DNS records must point
to GitHub Pages for GitHub's automatic hostname redirect and HTTPS certificate
to work. See GitHub's
[custom-domain configuration](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
and [HTTPS settings](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

GitHub Pages serves static HTML and does not provide per-path HTTP redirect
rules in this repository. The formatter alias therefore uses an instant meta
refresh, which Google treats as a permanent redirect, plus a matching absolute
canonical and fallback link. The alias drops unused query parameters. A browser
script preserves bookmark fragments on the same canonical destination. See Google's
[redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects).
An HTTP 301 for this alias would require redirect support at a hosting or proxy
layer. Do not add redirect files for other hosting services and expect GitHub
Pages to apply them.

Do not use `noindex` to consolidate the alias with its destination; rely on the
redirect and canonical together. Google's
[canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
explains why `noindex` is unsuitable for canonical selection.

After publishing, rerun the live audit and use **Test live URL** for the exact
**Redirect error** examples and their canonical destinations. Use **Validate
Fix** when the affected chains are working. Request indexing for an affected
canonical destination if it still needs recrawling. Google updates report
history as it revisits the URLs.

## Check and measure the crontab page

After publishing changes to `/crontab/`:

1. Inspect `https://native-cube.com/crontab/` with **Test live URL**. Confirm HTTP
   200, an indexable response, and the exact same user-declared canonical. The
   slashless URL, `/index.html` variant, query strings, and share fragments must
   not become separate sitemap entries.
2. Review the rendered HTML and screenshot. The crontab heading, quick-start
   instructions, syntax guide, examples, scheduler notes, FAQ, and ordinary
   navigation links are in the original HTML. Only interactive calculations
   require JavaScript. Keep the tool's default preview at two runs.
3. Validate the JSON-LD with the
   [Schema Markup Validator](https://validator.schema.org/) and Google's
   [Rich Results Test](https://search.google.com/test/rich-results). `WebPage`,
   `WebApplication`, `BreadcrumbList`, `Person`, and `ImageObject` describe the
   actual content and free access. Google's
   [software app rich-result requirements](https://developers.google.com/search/docs/appearance/structured-data/software-app)
   include a genuine rating or review; the tool does not currently publish
   either. Do not invent one to remove an eligibility warning. The visible FAQ
   does not imply eligibility for FAQ rich results, which Google
   [limits to qualifying government and health sites](https://developers.google.com/search/blog/2023/08/howto-faq-changes).
4. Request indexing for the canonical URL after the live checks pass, and
   confirm that Google's selected canonical eventually matches it. Account
   ownership and URL inspection are performed in Search Console; a passing
   local audit cannot establish that a page is indexed.
5. In **Performance → Search results**, filter **Page** to the exact canonical
   URL. Compare impressions, clicks, CTR, and average position over comparable
   date ranges, then segment by device, country, and query. Initial query groups
   to inspect include crontab generators, cron expression testers, common
   schedules, and time-zone questions. These are hypotheses, not measured
   keyword volumes or ranking predictions.
6. Check the **Core Web Vitals** report when field data is available. Local
   Lighthouse scores measure a lab run, not real-user performance or ranking.

The SEO audit verifies the crontab schema relationships, matching page and social
titles, static examples, incoming links from related tools, and agreement between
`dateModified` and sitemap `lastmod`. It runs in the existing Lighthouse and SEO
workflow. Shared schedules remain URL fragments and retain the same clean
canonical, following Google's
[canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).

## Check and measure the JSON and YAML diff page

After publishing `/json-diff/`:

1. Inspect `https://native-cube.com/json-diff/` with **Test live URL**. Confirm an
   indexable HTTP 200 response and the exact canonical URL with its trailing
   slash. Submit that canonical URL for indexing after the live checks pass.
2. Check the original HTML and the rendered page. The heading, comparison
   instructions, JSON and YAML examples, FAQ, related tools, and ordinary
   navigation links are static HTML. Only comparison and highlighting require
   JavaScript. Confirm that the live editor still works on desktop and mobile.
3. Validate the linked `WebPage`, `WebApplication`, `BreadcrumbList`, `Person`,
   and `ImageObject` entities with the
   [Schema Markup Validator](https://validator.schema.org/) and
   [Rich Results Test](https://search.google.com/test/rich-results). Keep the
   feature list accurate. The page does not publish ratings or reviews; do not
   invent them to remove rich-result eligibility warnings.
4. In the Search Console performance report, filter to the exact page URL.
   Monitor impressions, clicks, CTR, and position for JSON diff, JSON compare,
   YAML diff, compare YAML files, and Kubernetes manifest comparison queries.
   These are query groups to investigate, not verified search volumes or
   ranking predictions. Check actual indexing and selected canonical in Search
   Console; passing local checks cannot establish either.
5. Keep `WebPage.dateModified` and sitemap `lastmod` aligned when content changes.
   The local SEO audit enforces their agreement, page and social metadata,
   schema relationships, static examples, and incoming links from the homepage
   and formatter. Run `python3 scripts/check-redirects.py` after deployment to
   verify the published redirects and canonical destinations.

## Keep sitemap dates accurate

Update a page's `lastmod` when its public content or metadata changes. The
Terraform renderer updates its sitemap date from the published catalogue's
`synced_at` value while preserving a later manual edit date. Include `sitemap.xml`
in catalogue update commits. The local SEO audit rejects a Terraform sitemap
date older than the catalogue. Do not reset every date simply because CI ran.
