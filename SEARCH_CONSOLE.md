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
   - `https://native-cube.com/crontab/`
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

Search Console's **Page with redirect** is expected for HTTP, `www`, the old
GitHub Pages hostname, paths missing their trailing slash, and `/json-formatter/`.
Google indexes the destination instead. Those source URLs should remain
excluded; repeatedly validating them as indexable pages will not fix anything.

**Redirect error** is different: Google could not follow a chain because of a
loop, excessive redirects, an invalid or empty destination, or an overly long
URL. Copy the exact affected URL from the report and inspect every hop and the
final destination. **Alternate page with proper canonical tag** is also expected
for `/index.html` duplicates that GitHub Pages serves with HTTP 200.

These distinctions are documented in Google's
[Page indexing report help](https://support.google.com/webmasters/answer/7440203).

## Check the deployed site

Run the dependency-free live audit after deployment:

```sh
python3 scripts/check-redirects.py
```

It checks every sitemap page across HTTP/HTTPS, apex/`www`, and the old GitHub
Pages hostname, plus slashless paths, `index.html` duplicates, and the formatter
alias. It follows HTTP and instant meta-refresh redirects explicitly, rejects
loops and temporary or insecure redirects, and checks that each final page is
HTTP 200 with the expected canonical and no indexing restrictions. The separate
**Live redirect checks** workflow runs weekly and can be started manually in
Actions. It checks production, so run it after the source changes are published.

An optional user agent helps investigate response differences:

```sh
python3 scripts/check-redirects.py --user-agent Googlebot
```

Changing a user-agent string does not reproduce Google's crawler network or
replace Search Console's **Test live URL**.

Public HTTP checks on 2 November 2026 confirmed that all eight canonical pages
returned 200 and the tested HTTP, `www`, and GitHub Pages variants redirected
permanently to the apex HTTPS URLs. The formatter alias still served the old
`noindex` directive before this change was deployed. This is a consolidation
signal issue; it does not prove the cause of an account's **Redirect error**.

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
canonical and fallback link. JavaScript preserves query strings and fragments
for visitors. See Google's
[redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects).
An HTTP 301 for this alias would require redirect support at a hosting or proxy
layer. Do not add redirect files for other hosting services and expect GitHub
Pages to apply them.

Do not use `noindex` to consolidate the alias with its destination; rely on the
redirect and canonical together. Google's
[canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
explains why `noindex` is unsuitable for canonical selection.

After publishing, rerun the live audit, resubmit the canonical sitemap, and use
**Test live URL** for each affected destination. Request indexing for canonical
pages and validate actual **Redirect error** fixes. Historical exclusions remain
until Google recrawls them, and intentional redirects remain excluded.

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

## Keep sitemap dates accurate

Update a page's `lastmod` when its public content or metadata changes. The
Terraform renderer updates its sitemap date from the published catalogue's
`synced_at` value while preserving a later manual edit date. Include `sitemap.xml`
in catalogue update commits. The local SEO audit rejects a Terraform sitemap
date older than the catalogue. Do not reset every date simply because CI ran.
