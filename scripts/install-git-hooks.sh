#!/bin/sh
[ -n "$CI" ] && exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[ -x node_modules/.bin/lefthook ] || exit 0
exec node_modules/.bin/lefthook install --reset-hooks-path
