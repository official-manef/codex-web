#!/usr/bin/env bash
# Refuse to commit a credential.
#
# This repository drives gateways that authenticate with bearer tokens, and it is public. A
# single accidental `git add` publishes the value permanently. Scans every tracked file by
# default, so the check is meaningful outside a commit hook too.
#
#   bash scripts/secret-scan.sh          # every tracked file
#   bash scripts/secret-scan.sh --staged # only what is staged
set -uo pipefail

PATTERNS=(
	'sk-[A-Za-z0-9_-]{16,}'              # gateway / provider keys
	'Bearer [A-Za-z0-9._-]{20,}'         # literal bearer values
	'ghp_[A-Za-z0-9]{20,}'               # GitHub classic
	'gho_[A-Za-z0-9]{20,}'               # GitHub OAuth
	'github_pat_[A-Za-z0-9_]{20,}'       # GitHub fine-grained
	'xox[baprs]-[A-Za-z0-9-]{10,}'       # Slack
	'AKIA[0-9A-Z]{16}'                   # AWS
	'-----BEGIN [A-Z ]*PRIVATE KEY-----' # PEM
)

# ponytail: test files are excluded because they hold deliberate fake credentials (one exists
# solely to prove the log redactor strips it). The ceiling: a real key pasted into a spec would
# not be caught here. Upgrade path — replace the exclusion with a per-line opt-in comment once
# the spec fixtures are renamed to an obviously-fake shape.
EXCLUDE_RE='(\.spec\.[cm]?[jt]s$|\.test\.[cm]?[jt]s$|/fixtures?/)'

if [ "${1:-}" = "--staged" ]; then
	targets=$(git diff --cached --name-only --diff-filter=ACM)
else
	targets=$(git ls-files)
fi
targets=$(echo "$targets" | grep -vE "$EXCLUDE_RE")
[ -z "$targets" ] && exit 0

failed=0
for pattern in "${PATTERNS[@]}"; do
	# -I skips binaries; -n prints the line so the file can be fixed precisely.
	hits=$(echo "$targets" | tr '\n' '\0' | xargs -0 -r grep -InE "$pattern" 2>/dev/null || true)
	if [ -n "$hits" ]; then
		echo "refusing to commit: matched /$pattern/" >&2
		echo "$hits" | sed 's/^/  /' | head -20 >&2
		failed=1
	fi
done

if [ "$failed" -ne 0 ]; then
	echo "" >&2
	echo "Remove the value, or stage it out. If it is a false positive on a documented shape," >&2
	echo "rewrite the example so it cannot be mistaken for a real credential." >&2
	exit 1
fi
