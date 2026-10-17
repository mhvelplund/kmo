#!/usr/bin/env -S usage bash
#USAGE about "Writes the pages of docs/ into a directory in the form a GitHub wiki needs"
#USAGE long_about #"""
#USAGE Writes the pages of docs/ into a directory in the form a GitHub wiki needs:
#USAGE index.md becomes Home.md and the links between pages lose their .md ending.
#USAGE The images in docs/ are copied as they are. Each Markdown file and image
#USAGE already in the directory is deleted first. Makes no git or network call.
#USAGE """#
#USAGE arg "<dir>" help="The directory to write to, usually a clone of the wiki"
set -euo pipefail
shopt -s nullglob

DOCS=$(dirname "${BASH_SOURCE[0]}")/../../docs
OUT=${usage_dir:?}

mkdir -p "$OUT"
IMAGES=(png svg jpg jpeg gif)
for ext in md "${IMAGES[@]}"; do
  rm -f "$OUT"/*."$ext"
done

for page in "$DOCS"/*.md; do
  name=$(basename "$page")
  [[ $name == index.md ]] && name=Home.md
  sed -E 's/\]\(index\.md([#)])/](Home\1/g; s/\]\(([A-Za-z0-9_-]+)\.md([#)])/](\1\2/g' "$page" >"$OUT/$name"
done

for ext in "${IMAGES[@]}"; do
  for image in "$DOCS"/*."$ext"; do
    cp "$image" "$OUT/"
  done
done

echo "These pages are made from the folder \`docs\` of the repository. A change made here is overwritten." \
  >"$OUT/_Footer.md"

BROKEN=0
for page in "$OUT"/*.md; do
  while read -r target; do
    target=${target#./}
    if [[ ! -f $OUT/$target.md && ! -f $OUT/$target ]]; then
      echo "$(basename "$page"): the link to '$target' has no page" >&2
      BROKEN=1
    fi
  done < <(grep -oE '\]\([^)#]+' "$page" | cut -c3- | grep -vE '^[a-z]+:' || true)
done
exit "$BROKEN"
