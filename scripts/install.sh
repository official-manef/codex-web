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

# Node 22 or 24 is required to DEPLOY Convex 'use node' actions; anything newer is refused by
# Convex with `DeploymentNotConfiguredForNodeActions`. That is a Convex deployment limit, not a
# limit on building or serving this app: `vite build` and `node build` run on a newer major.
# So this warns and continues, exactly like scripts/install.mjs — an earlier version exited
# here, which made a Node 26 host unable to install a frontend it can serve perfectly well.
major="$(node -p 'process.versions.node.split(".")[0]')"
case "$major" in
22 | 24) ;;
*)
	echo "warning: Node $major found; Convex 'use node' actions need 22 or 24." >&2
	echo "         'convex deploy' will fail until you switch. With nvm:" >&2
	echo "         export PATH=\"\$HOME/.nvm/versions/node/v22.23.2/bin:\$PATH\"" >&2
	echo "         Build and serve are unaffected." >&2
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
