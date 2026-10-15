#!/usr/bin/env bash
set -euo pipefail

# Generates SDKs from the OpenAPI spec using the openapi-generator Docker image.
# Requirements: Docker installed and running.
#
# Output lands in clients/<lang>. Those directories hold curated packages, so
# review the generated tree before committing over one: the generator replaces
# whole directories rather than merging into them.

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
SPEC_REL="openapi/fuego-openapi.yaml"
OUT_REL="clients"
SPEC="${ROOT_DIR}/${SPEC_REL}"
OUT_BASE="${ROOT_DIR}/${OUT_REL}"
IMAGE="openapitools/openapi-generator-cli:v7.14.0"

langs=(
  "go"
  "java"
  "csharp"
  "swift5"
  "kotlin"
  "php"
  "ruby"
  "javascript"
  "python"
  "rust"
)

if [ ! -f "${SPEC}" ]; then
  echo "Spec not found: ${SPEC}" >&2
  exit 1
fi

mkdir -p "${OUT_BASE}"

for lang in "${langs[@]}"; do
  outdir="${OUT_BASE}/${lang}"
  echo "Generating ${lang} SDK -> ${outdir}"
  docker run --rm -u "$(id -u):$(id -g)" \
    -v "${ROOT_DIR}:/local" \
    ${IMAGE} generate \
      -i "/local/${SPEC_REL}" \
      -g "${lang}" \
      -o "/local/${OUT_REL}/${lang}" \
      --global-property apis,models,modelDocs=false,apiDocs=false,supportingFiles
  echo "Done ${lang}"
  echo
done

echo "All SDKs generated under ${OUT_BASE}."