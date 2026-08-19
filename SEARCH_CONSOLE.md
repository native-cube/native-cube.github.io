# Google Search Console setup

The repository is ready for Google Search Console: every indexable page has one
self-referencing `https://native-cube.com/.../` canonical, explicit index/follow
directives, matching Open Graph and structured-data URLs, and an entry in
`sitemap.xml`. `robots.txt` advertises that sitemap, while the duplicate
`/json-formatter/` alias remains excluded from indexing.

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
   - `https://native-cube.com/terraform-modules/`
4. Do not submit `/json-formatter/`; it is a `noindex` convenience alias.

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
