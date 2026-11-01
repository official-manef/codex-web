#!/usr/bin/env bash
# One-command install for a Linux host. Fetches the repository into ./codex-clone-placeholder
# (or $INSTALL_DIR) and hands over to scripts/install.mjs, which does the real work.
#
#   curl -fsSL https://raw.githubusercontent.com/rahmanef63/codex-clone-placeholder/main/scripts/install.sh \
#     | bash -s -- --site https://app.example.com --convex https://<deployment>.convex.cloud
#
# Every flag after `-s --` is passed through to install.mjs. This script deliberately does one
# thing: get the source and let the Node installer own the decisions, so there is only ever one
# implementation of "how this installs" to keep correct.
set -euo pipefail

REPO="${CODEX_REPO:-https://github.com/rahmanef63/codex-clone-placeholder.git}"
INSTALL_DIR="${INSTALL_DIR:-codex-clone-placeholder}"

say() { printf '  %s\n' "$*"; }

if ! command -v git >/dev/null 2>&1; then
	echo "error: git is required." >&2
	exit 1
fi

if ! command -v node >/dev/null 2>&1; then
	echo "error: node is required (22 or 24). Install Node, then re-run." >&2
	exit 1
fi

# Node 22 or 24 only: Convex refuses to deploy 'use node' actions on anything newer.
major="$(node -p 'process.versions.node.split(".")[0]')"
case "$major" in
22 | 24) ;;
*)
	echo "error: Node $major found, but Convex needs 22 or 24 for 'use node' actions." >&2
	echo "       With nvm: export PATH=\"\$HOME/.nvm/versions/node/v22.23.2/bin:\$PATH\"" >&2
	exit 1
	;;
esac

if ! command -v bun >/dev/null 2>&1; then
	echo "error: bun is required. Install it: curl -fsSL https://bun.sh/install | bash" >&2
	exit 1
fi

if [ -d "$INSTALL_DIR/.git" ]; then
	say "updating existing checkout in $INSTALL_DIR"
	git -C "$INSTALL_DIR" pull --ff-only
else
	say "cloning into $INSTALL_DIR"
	git clone --depth 1 "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
say "handing over to scripts/install.mjs"
exec node scripts/install.mjs "$@"
