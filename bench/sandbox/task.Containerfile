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

# The sandbox every trial runs in, pinned by digest. bench-sandbox.yml pushes `:main` on each change
# to bench/sandbox; Dependabot (docker ecosystem) then proposes the new digest here. The runner reads
# this FROM line and adds the task's app on top of it.
FROM ghcr.io/axel7083/agent-skills/bench-sandbox:main@sha256:67d2d6559dcaca294f12011d47d0f7dccdb12ab549e802c280e90f60c9fde399
