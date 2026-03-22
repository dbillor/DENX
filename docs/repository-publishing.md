# Repository Publishing

This project is meant to be published as the Denx service codebase, without the private personal knowledge vault.

## What Stays Local

The following are intentionally excluded from version control:

- `vault/`
- `.env`
- `logs/`
- `tmp/`
- `.venv/`
- `docs/source-papers/`

That keeps personal knowledge, transcripts, audio, secrets, and local reference material off GitHub.

## Recommended GitHub Model

- GitHub repo: private
- Source of truth for code: this repository
- Source of truth for knowledge: local Obsidian vault plus Obsidian Sync

## Manual Publish Steps

If GitHub CLI is not available on the Mac:

1. Create a new **private** empty repository on GitHub, for example `denx`.
2. Initialize git locally if needed.
3. Commit the code and docs.
4. Add the remote GitHub URL.
5. Push `main`.

## Example Commands

```bash
git init -b main
git add .
git commit -m "Initial Denx service"
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/denx.git
git push -u origin main
```

If you prefer HTTPS:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/denx.git
git push -u origin main
```

## Before Pushing

Run:

```bash
git status --short
```

Confirm that `vault/`, `.env`, and other private local directories are not listed.
