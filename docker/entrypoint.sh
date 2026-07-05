#!/bin/sh
# Runtime config for the Vite SPA.
#
# Vite inlines `import.meta.env.VITE_*` at build time, so the bundle is fixed
# once `vite build` runs. To keep a single image portable across staging /
# prod / etc., we baked PLACEHOLDERS into the bundle (see Dockerfile build
# stage: VITE_API_URL=__VITE_API_URL__) and rewrite them here, at container
# start, using values from the container environment.
#
# Result: same image, different envs — no rebuild required.

set -eu

ROOT="${WEB_ROOT:-/usr/share/nginx/html}"

# List the placeholders we substitute. Add new ones here as the app grows.
PLACEHOLDERS="VITE_API_URL VITE_WS_URL"

# Verify required env vars are set; without them the SPA throws on boot
# (see src/api/env.ts: "Missing required env var: ...").
missing=""
for var in $PLACEHOLDERS; do
  eval "val=\${$var:-}"
  if [ -z "$val" ]; then
    missing="$missing $var"
  fi
done
if [ -n "$missing" ]; then
  echo "[entrypoint] FATAL: missing required env vars:$missing" >&2
  echo "[entrypoint]   Set them in your .env file or compose 'environment:' block." >&2
  exit 1
fi

echo "[entrypoint] Injecting runtime config into $ROOT ..."

# Files that may carry placeholders: built JS bundles + index.html.
# `find ... -exec` keeps it portable (no bash arrays, no xargs quoting woes).
find "$ROOT" \( -name '*.js' -o -name '*.html' -o -name '*.css' \) -type f | while IFS= read -r file; do
  changed=0
  for var in $PLACEHOLDERS; do
    eval "val=\${$var}"
    placeholder="__${var}__"
    if grep -q "$placeholder" "$file" 2>/dev/null; then
      # Use a sed delimiter unlikely to appear in URLs. '|' is safe for
      # http(s)://host:port/path and ws(s)://... values.
      tmp="${file}.tmp"
      sed "s|${placeholder}|${val}|g" "$file" > "$tmp" && mv "$tmp" "$file"
      changed=1
    fi
  done
  if [ "$changed" = "1" ]; then
    echo "[entrypoint]   patched $file"
  fi
done

echo "[entrypoint] Runtime config applied. Handing off to nginx."
