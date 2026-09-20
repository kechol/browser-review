#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# UserPromptSubmit hook: put any waiting browser-review comments in front of the
# model, so the user does not have to ask "did anything come in?".
#
# Anything unexpected exits 0 with no output. A hook that fails loudly on every
# prompt is worse than one that quietly does nothing.
set -u

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 0

command -v node >/dev/null 2>&1 || exit 0
exec node "$dir/inject-pending.mjs"
