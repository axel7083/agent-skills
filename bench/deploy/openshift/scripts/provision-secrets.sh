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

# Creates the bench's Secrets on OpenShift. Run from a machine logged in with oc:
#   BENCH_CONTEXT=<kubeconfig context> BENCH_NAMESPACE=<namespace> bench/deploy/openshift/scripts/provision-secrets.sh
# Generated once, then kept: the database passwords, Bifrost's admin password and encryption key
# (Bifrost can't change its encryption key: keep a copy outside the cluster). The upstream LLM key is
# read from ENMAAS_KEY, or asked for without echo; re-running with it set replaces it. Values never
# reach the terminal or a command line: they go through pipes into a server-side apply.
set -euo pipefail

NS="${BENCH_NAMESPACE:?set BENCH_NAMESPACE to the target namespace}"
# The kubeconfig context to use, whatever the current one is (another tool may switch it meanwhile).
CONTEXT="${BENCH_CONTEXT:-$(command oc config current-context)}"
oc() { command oc --context "$CONTEXT" --namespace "$NS" "$@"; }

# A key of an existing Secret, or nothing.
current() { { oc get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null || true; } | base64 -d; }

# name, then key=file pairs (process substitutions).
apply_secret() {
  local name="$1"
  shift
  oc create secret generic "$name" --dry-run=client -o yaml "${@/#/--from-file=}" |
    oc label --local -f - -o yaml app.kubernetes.io/part-of=agent-skills-bench |
    oc apply --server-side --field-manager=bench-provision --force-conflicts -f - >/dev/null
  echo "   secret/$name"
}

oc whoami >/dev/null || { echo "log in with oc first" >&2; exit 1; }
echo "==> secrets in $NS on $(oc whoami --show-server) ($CONTEXT)"

bench_password="$(current bench-postgres bench-password)"
bifrost_db_password="$(current bench-postgres bifrost-password)"
[[ -n "$bench_password" ]] || bench_password="$(openssl rand -hex 24)"
[[ -n "$bifrost_db_password" ]] || bifrost_db_password="$(openssl rand -hex 24)"
apply_secret bench-postgres \
  bench-password=<(printf %s "$bench_password") \
  bifrost-password=<(printf %s "$bifrost_db_password")

admin_password="$(current bench-bifrost admin-password)"
encryption_key="$(current bench-bifrost encryption-key)"
if [[ -z "$encryption_key" ]]; then
  admin_password="$(openssl rand -hex 24)"
  encryption_key="$(openssl rand -hex 32)"
  echo "   Bifrost's admin password and encryption key generated: copy the encryption key outside the cluster"
fi
upstream_key="${ENMAAS_KEY:-}"
[[ -n "$upstream_key" ]] || upstream_key="$(current bench-bifrost upstream-key)"
if [[ -z "$upstream_key" ]]; then
  read -rsp "   upstream LLM key (ENMAAS_KEY): " upstream_key </dev/tty
  echo
fi
[[ -n "$upstream_key" ]] || { echo "no upstream LLM key" >&2; exit 1; }
apply_secret bench-bifrost \
  admin-password=<(printf %s "$admin_password") \
  encryption-key=<(printf %s "$encryption_key") \
  upstream-key=<(printf %s "$upstream_key")
