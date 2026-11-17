#!/usr/bin/env bash
#
# Copyright (C) 2026 Red Hat, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0
#

# Deploys this checkout's bench to OpenShift. Run from a machine logged in with oc, after
# provision-secrets.sh:
#   BENCH_CONTEXT=<kubeconfig context> BENCH_NAMESPACE=<namespace> bench/deploy/openshift/scripts/deploy.sh
# GitHub never holds a credential to the cluster: an operator applies a clean checkout of main
# (BENCH_DEPLOY_UNMERGED=1 allows another commit).
set -euo pipefail

NS="${BENCH_NAMESPACE:?set BENCH_NAMESPACE to the target namespace}"
# The kubeconfig context to use, whatever the current one is (another tool may switch it meanwhile).
CONTEXT="${BENCH_CONTEXT:-$(command oc config current-context)}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DIR="$ROOT/bench/deploy/openshift"
IMAGE=ghcr.io/axel7083/agent-skills/bench-server
REQUIRED=(secret/bench-postgres secret/bench-bifrost)
FIELD_MANAGER=bench-deploy

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }
oc() { command oc --context "$CONTEXT" --namespace "$NS" "$@"; }

main() {
  oc whoami >/dev/null || die "log in with oc first"

  log "checkout"
  git -C "$ROOT" diff --quiet HEAD && git -C "$ROOT" diff --cached --quiet && [[ -z "$(git -C "$ROOT" ls-files --others --exclude-standard)" ]] ||
    die "the checkout has uncommitted changes: deploy a commit"
  local commit
  commit="$(git -C "$ROOT" rev-parse HEAD)"
  git -C "$ROOT" fetch --quiet origin main
  if [[ "$commit" != "$(git -C "$ROOT" rev-parse origin/main)" ]]; then
    [[ "${BENCH_DEPLOY_UNMERGED:-}" == 1 ]] || die "HEAD ${commit:0:7} is not origin/main (BENCH_DEPLOY_UNMERGED=1 to deploy it anyway)"
    echo "   ${commit:0:7} is not origin/main (BENCH_DEPLOY_UNMERGED=1)"
  fi
  echo "   ${commit:0:7} → $NS on $(oc whoami --show-server) ($CONTEXT)"
  oc get "namespace/$NS" >/dev/null 2>&1 || oc get "project/$NS" >/dev/null 2>&1 || die "no namespace $NS on that cluster"

  log "prerequisites"
  local object
  for object in "${REQUIRED[@]}"; do oc get "$object" >/dev/null 2>&1 || die "$object is missing: run provision-secrets.sh"; done

  BUILD="$(mktemp -d)"
  trap 'rm -rf "$BUILD"' EXIT
  command oc kustomize --load-restrictor LoadRestrictionsNone "$DIR" >"$BUILD/manifests.yaml"

  # The digest the ImageStream holds (importing it on a first deploy): a deploy applies that same
  # digest, so it never moves the server either forward or back.
  log "server image"
  oc apply --server-side --field-manager="$FIELD_MANAGER" --force-conflicts -f "$DIR/server-imagestream.yaml" >/dev/null
  local reference="" _
  for _ in $(seq 1 60); do
    reference="$(oc get imagestream/bench-server -o jsonpath='{.status.tags[?(@.tag=="main")].items[0].dockerImageReference}')"
    [[ -n "$reference" ]] && break
    sleep 2
  done
  [[ "$reference" =~ ^${IMAGE//./\\.}@sha256:[0-9a-f]{64}$ ]] || die "imagestream/bench-server has no imported digest"
  echo "   ${reference#*@}"
  sed -i "s|image: ${IMAGE}:main$|image: ${reference}|" "$BUILD/manifests.yaml"
  grep -Eq "image: ${IMAGE//./\\.}@sha256:[0-9a-f]{64}$" "$BUILD/manifests.yaml" || die "the server image is not pinned by digest"

  log "apply"
  oc apply --server-side --field-manager="$FIELD_MANAGER" --force-conflicts -f "$BUILD/manifests.yaml" | sed 's/^/   /'

  log "rollout"
  local failed=()
  oc rollout status statefulset/bench-postgres --timeout=5m || failed+=(statefulset/bench-postgres)
  for object in deployment/bench-bifrost deployment/bench-server deployment/bench-edge; do
    oc rollout status "$object" --timeout=5m || failed+=("$object")
  done
  ((${#failed[@]} == 0)) || die "not healthy: ${failed[*]}"
  echo "   healthy on ${commit:0:7}: https://$(oc get route bench -o jsonpath='{.spec.host}')"
}

main "$@"
