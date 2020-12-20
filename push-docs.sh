#!/usr/bin/env bash
set -o errexit
set -o pipefail

BRANCH=`git rev-parse --abbrev-ref HEAD`
DATE=`date "+%Y-%m-%d"`
HASH=`git rev-parse --short HEAD`

ROOT_DOCS_URL_PATH="vitessce-data/docs-root/$DATE/$HASH"
VERSIONED_DOCS_URL_PATH="vitessce-data/docs/$DATE/$HASH"

die() { set +v; echo "$*" 1>&2 ; exit 1; }
git diff --quiet || die 'Uncommitted changes: Stash or commit before pushing docs.'

echo '{
  "note": "This file is regenerated by push-docs.sh.",
  "branch": "'$BRANCH'",
  "date": "'$DATE'",
  "hash": "'$HASH'"
}' > docs/version.json

# Build library...
npm run build-lib:prod
npm link docs/node_modules/react

# Build docs site...
cd docs
# We need to build the docs site twice:
# 1. With baseUrl: "/" which may be copied to vitessce.io (by running ./copy-prod.sh).
# 2. With baseUrl: "/vitessce-data/docs/2020-12-19/b416e16/" for the staging and versioned access.
export VITESSCE_DOCS_BASE_URL="/"
npm run build-root
export VITESSCE_DOCS_BASE_URL="/$VERSIONED_DOCS_URL_PATH/"
npm run build-versioned
# Un-set the base url exported variable.
unset VITESSCE_DOCS_BASE_URL

# The following lines are relative to docs/ directory.
ROOT_DIST_DIR='dist-root/'
VERSIONED_DIST_DIR='dist-versioned/'
# and add an error page for vitessce.io...
cp ../error.html $ROOT_DIST_DIR
cp ../error.html $VERSIONED_DIST_DIR
# and push to S3.
aws s3 cp --recursive $ROOT_DIST_DIR s3://$ROOT_DOCS_URL_PATH
aws s3 cp --recursive $VERSIONED_DIST_DIR s3://$VERSIONED_DOCS_URL_PATH
VERSIONED_TARGET_URL="https://s3.amazonaws.com/$VERSIONED_DOCS_URL_PATH/index.html"
COPY_TARGET_URL="https://s3.amazonaws.com/$ROOT_DOCS_URL_PATH/index.html"

echo "- $DATE: [$BRANCH]($VERSIONED_TARGET_URL)" >> ../DOCS.md

echo "Deployed to $VERSIONED_TARGET_URL"
echo "Copy to $COPY_TARGET_URL"
# Open in browser and see if it works:
open "$VERSIONED_TARGET_URL"
