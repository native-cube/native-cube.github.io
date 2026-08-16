# Google Search Console setup

The repository is ready for Google Search Console: canonical pages are listed
in `sitemap.xml`, `robots.txt` advertises that sitemap, and the
`/json-formatter/` alias is excluded from indexing.

Ownership verification must be completed by a Google account with access to
Search Console. The verification value is account-issued and must not be
invented or replaced with a placeholder.

## Verify the property

1. Open [Google Search Console](https://search.google.com/search-console/).
2. Add a **URL-prefix property** for `https://native-cube.com/`.
   A Domain property is not suitable because the repository owner cannot
   publish DNS records for the shared `github.io` domain.
3. Choose **HTML file** as the verification method.
4. Download the exact `google*.html` verification file.
5. Add that file unchanged to the repository root, deploy GitHub Pages, and
   confirm that `https://native-cube.com/google*.html` returns the
   verification text.
6. Select **Verify** in Search Console. Keep the file in the repository after
   verification so ownership remains valid.

## Submit and inspect

1. Open **Sitemaps** for the verified property.
2. Submit `https://native-cube.com/sitemap.xml`.
3. Use **URL inspection** for these canonical URLs and request indexing:
   - `https://native-cube.com/`
   - `https://native-cube.com/k8s-manifest-builder/`
   - `https://native-cube.com/visual-subnet-calculator/`
   - `https://native-cube.com/yaml-formatter/`
   - `https://native-cube.com/terraform-modules/`
4. Do not submit `/json-formatter/`; it is a `noindex` convenience alias.

The account owner can provide the downloaded verification file to a
contributor for placement, but should not share Google credentials.
