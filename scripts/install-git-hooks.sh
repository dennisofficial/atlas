#!/bin/sh
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git config core.hooksPath .githooks
