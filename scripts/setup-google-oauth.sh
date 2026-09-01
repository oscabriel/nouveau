#!/usr/bin/env bash
#
# Wizard: create the dev Google OAuth app for Nouveau and set its credentials
# on the dev Convex deployment (cool-giraffe-632).
#
# Everything above the "STAGES" marker is the wizard library: do not hand-edit
# it. Author the per-step stages below the marker.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()
WRITTEN_SECRET=()
SKIPPED=()

_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser; visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES
# ──────────────────────────────────────────────────────────────────────────

TOTAL_STAGES=4

DEV_REDIRECT_URI="https://cool-giraffe-632.convex.site/oauth/google/callback"

banner "Nouveau: dev Google OAuth app"

# ── Stage 1: GCP project ──────────────────────────────────────────────────
stage "Google Cloud project"
say "The OAuth app lives inside a Google Cloud project. If you already have"
say "one you want to use (for Nouveau dev), keep its id."
ask GCP_PROJECT_ID "Existing or new project id (blank = create a fresh one):"
if [[ -n "$GCP_PROJECT_ID" ]]; then
  open_url "https://console.cloud.google.com/welcome?project=$GCP_PROJECT_ID"
else
  open_url "https://console.cloud.google.com/projectcreate"
  say "Create a project (any name, e.g. 'nouveau-dev'), then copy its id."
  ask GCP_PROJECT_ID "Paste the new project id:"
fi
note "All later links use project $GCP_PROJECT_ID — make sure the console is"
note "scoped to it (top-left project picker)."

# ── Stage 2: consent screen + test users ──────────────────────────────────
stage "OAuth consent screen"
say "Google Auth Platform (the new console UI) calls this 'Branding'; in the"
say "classic UI it is 'APIs & Services → OAuth consent screen'."
open_url "https://console.cloud.google.com/auth/brand-overview?project=$GCP_PROJECT_ID"
step "Set the user type to External (personal Google accounts sign in)."
step "Fill in: app name (e.g. 'Nouveau dev'), user support email,"
step "developer contact email. Finish and save the branding."
step "Then open the Audience page and add YOUR Google account as a test user."
open_url "https://console.cloud.google.com/auth/audience?project=$GCP_PROJECT_ID"
note "While the app is in 'Testing', only test users can sign in. Add yourself,"
note "or the round-trip check will fail with access_blocked."
pause "Done? Press Enter to continue."

# ── Stage 3: OAuth client ─────────────────────────────────────────────────
stage "OAuth client ID + secret"
open_url "https://console.cloud.google.com/auth/clients/create?project=$GCP_PROJECT_ID"
step "Application type: Web application."
step "Name: Nouveau dev (any name)."
step "Under Authorized redirect URIs, add exactly:"
note "    $DEV_REDIRECT_URI"
note "  (This is the OAuth component's callback on the dev deployment. The"
note "   browser itself is redirected back to the app origin — localhost:3004 or"
note "   the SITE_URL env var — which the backend allowlists; no localhost or"
note "   gneiss.run URI goes into Google.)"
say "Authorized JavaScript origins are not needed for this flow."
step "Create, then copy the client ID and the client secret."
ask GOOGLE_CLIENT_ID "Paste the client ID:"
ask_secret GOOGLE_CLIENT_SECRET "Paste the client secret (input hidden):"
if [[ -z "$GOOGLE_CLIENT_ID" || -z "$GOOGLE_CLIENT_SECRET" ]]; then
  warn "client id/secret are empty; stage 4 will fail until you provide them"
fi
write_env GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
write_env GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"

# ── Stage 4: set credentials on the dev deployment ────────────────────────
stage "Set credentials on dev deployment"
say "This runs from the repo root, which targets dev (cool-giraffe-632) via"
say ".env.local. You should see the dev deployment named in the CLI output."
if confirm "Set AUTH_GOOGLE_CLIENT_ID/SECRET on dev now?"; then
  npx convex env set AUTH_GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
  npx convex env set AUTH_GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"
  note "Next: ask the agent to push the v2 auth wiring and verify sign-in."
else
  SKIPPED+=("convex env AUTH_GOOGLE_CLIENT_ID / AUTH_GOOGLE_CLIENT_SECRET")
  note "Run later:"
  note "  npx convex env set AUTH_GOOGLE_CLIENT_ID '<client id>'"
  note "  npx convex env set AUTH_GOOGLE_CLIENT_SECRET '<secret>'"
fi

finish
