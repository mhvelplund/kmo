---
paths:
  - "docs/**"
  - "README.md"
---

# Work on the documentation

- The docs are written for people: high level, few code fences.
- Use ASD-STE100 Simplified Technical English.
- `docs/index.md` is the entry point and lists every page. Add a new page there. The default page in any sub-folder of
  `docs` is named `index.md`.
- One place for each fact. `docs/design.md` holds the reasons, and `docs/configsync.md`, `docs/stores.md` and
  `docs/receiver.md` hold the rules. Link to them; do not repeat them.
- The root README is a short introduction and file layout, a pointer to `docs/index.md`, and installation instructions
  for a cluster, in full or by link.
- Two spaces at the end of a line are a forced line break. Prettier, markdownlint and the hooks keep them when text
  follows on the next line. Prettier removes them at the end of a paragraph, where they break nothing.
- `mise run lint` runs the Prettier check and markdownlint on every Markdown file.
