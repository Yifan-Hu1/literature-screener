#!/bin/sh
# Publishes a tested version to the public download repository (no source code).
# Usage: scripts/publish-public.sh v0.1.0-alpha.2
# Needs: the tag's GitHub Actions run to have succeeded, and `gh` logged in.
set -e
TAG="$1"
PRIVATE=Yifan-Hu1/literature-screener
PUBLIC=Yifan-Hu1/literature-screener-app
NOREPLY=169463374+Yifan-Hu1@users.noreply.github.com
[ -n "$TAG" ] || { echo "Usage: $0 <tag>"; exit 1; }
cd "$(dirname "$0")/.."

RUN=$(gh run list -R "$PRIVATE" --branch "$TAG" --workflow build.yml --limit 1 --json databaseId,conclusion \
  --jq '.[0] | select(.conclusion == "success") | .databaseId')
[ -n "$RUN" ] || { echo "No successful build for $TAG yet."; exit 1; }

WORK=$(mktemp -d)
gh run download "$RUN" -R "$PRIVATE" --pattern 'installers-*' -D "$WORK/artifacts"
mkdir "$WORK/files"
find "$WORK/artifacts" -type f \( -name '*.dmg' -o -name '*.exe' -o -name '*.zip' \) -exec cp {} "$WORK/files/" \;

npm run guide >/dev/null
cp release/Literature-Screener-tester-guide.pdf "$WORK/files/"

# Update the website (download page, feedback page, guide).
gh repo clone "$PUBLIC" "$WORK/site" -- -q
cp -R site/. "$WORK/site/"
cp release/Literature-Screener-tester-guide.pdf "$WORK/site/"
(
  cd "$WORK/site"
  git config user.email "$NOREPLY"
  git config user.name Prometheus69
  git add -A
  git commit -q -m "Site for $TAG" || echo "Site unchanged."
  git push -q
)

gh release create "$TAG" "$WORK"/files/* -R "$PUBLIC" --latest \
  --title "Literature Screener ${TAG#v}" \
  --notes "Alpha test version. Download page: https://yifan-hu1.github.io/literature-screener-app/"
echo "Published $TAG: https://yifan-hu1.github.io/literature-screener-app/"
