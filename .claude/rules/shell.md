---
paths:
  - "**/*.sh"
---

# Shell scripts

- The shebang is `#!/usr/bin/env -S usage bash`, so `usage` reads the arguments and bash runs the script.
- The description is in `#USAGE` lines at the head: `about` for `-h`, and `long_about` when `--help` must say more. A
  script without a `#USAGE` line does not start.
- Declare each argument and flag in the `#USAGE` lines and read it from its `usage_<name>` variable.
- A file that is only sourced, as `test/e2e/lib.sh` is, has no shebang.
- A script runs from any directory: it does not change directory, and it builds each path from its own location,
  `$(dirname "${BASH_SOURCE[0]}")`.
- `.shellcheckrc` and `.editorconfig` hold the settings of ShellCheck and shfmt. `mise run format` runs shfmt.
