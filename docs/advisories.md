# Known advisories

`npm audit` reports these advisories and no patched version exists yet. Each row says how the package reaches KMO and
whether KMO runs the affected code. Remove a row when a patched version is released and pinned.

Review this page again whenever dependencies change. The last review was on 2026-10-11, when the receiver package was
added: `npm audit` reported nothing new.

| Advisory            | Package            | How it reaches KMO | Does KMO run the affected code?                                                                                                                        | Why it cannot be cleared                                |
| ------------------- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| GHSA-86w9-cpqp-85rv | `node-forge` 1.4.0 | `pepr`             | No. The fault is in the check of an RSA signature. Pepr uses `node-forge` only on the build computer, to make and sign the certificate of its webhook. | 1.4.0 is the newest release and it is in the bad range. |

`npm audit` shows a second line for `pepr` itself. That line is the same advisory, counted again for the package that
brings it.
