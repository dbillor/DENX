#!/bin/zsh
set -euo pipefail

VAULT_PATH="${VAULT_PATH:-/Users/dbillorgmail.com/Documents/personal operating system/vault}"

exec ob sync --continuous --path "$VAULT_PATH"
