# Known advisories

`npm audit` reports these advisories and no patched version exists yet. Each row says how the package reaches KMO and
whether KMO runs the affected code. Remove a row when a patched version is released and pinned.

Review this page again whenever dependencies change. The last review was on 2026-11-27, when `node-forge`, `undici`,
`body-parser`, `ip-address` and `markdown-it` were updated. No advisory waits for a patched version, so there is no row.

`npm audit` still reports GHSA-g3hv-75wg-m249 in `minimatch`. Version 11.0.1 has the patch, but KMO does not pin it yet,
because the packages that bring `minimatch` ask for version 10. It reaches KMO through `eslint`, `typescript-eslint`,
`markdownlint-cli` and `pepr`. `npm audit` also counts the same advisory again for each package that brings it.
