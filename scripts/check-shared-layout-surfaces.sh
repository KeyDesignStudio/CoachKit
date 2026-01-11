#!/usr/bin/env bash
set -euo pipefail

# Guardrail: shared/global wrapper components must use token surfaces only.
# Keep this intentionally scoped to a small allowlist to avoid false positives.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FILES=(
  "apps/web/components/app-header.tsx"
  "apps/web/components/route-branding-bar.tsx"
  "apps/web/components/calendar/CalendarShell.tsx"
  "apps/web/app/layout.tsx"
)

# Fail if any of these Tailwind patterns are present in the files above.
# (Token backgrounds like bg-[var(--bg-page)] / bg-[var(--bg-surface)] / etc are allowed.)
BANNED_REGEX='(^|[[:space:]"]|\x27)bg-white(/|([[:space:]"]|\x27|$))|bg-gradient-|backdrop-blur|(^|[[:space:]"]|\x27)(from|via|to)-'

missing=0
scan_files=()
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    scan_files+=("$f")
  else
    echo "WARN: surface-guard file missing: $f" >&2
    missing=1
  fi
done

if (( ${#scan_files[@]} == 0 )); then
  echo "ERROR: surface-guard has no files to scan." >&2
  exit 2
fi

if grep -nE "$BANNED_REGEX" "${scan_files[@]}" >/dev/null; then
  echo "ERROR: Shared layout component must use token surfaces only. Avoid bg-white/*, bg-white, bg-gradient-*, backdrop-blur, or from-/via-/to- gradients." >&2
  echo "Offending matches:" >&2
  grep -nE "$BANNED_REGEX" "${scan_files[@]}" >&2 || true
  exit 1
fi

# If we ever hit missing files, it's still a success (we don't want to block CI on renames),
# but we emit a warning so the allowlist can be updated.
exit 0
