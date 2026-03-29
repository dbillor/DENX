# Obsidian Sync Setup

This project is configured for always-on private cloud sync for the vault using Obsidian Headless.

## Current Status

Completed on this Mac:

- `ob` installed
- Obsidian account authenticated
- remote sync vault created: `Personal Operating System`
- local vault linked to the remote vault
- initial sync started
- continuous background sync launch agent installed

Remote vault details:

- Vault name: `Personal Operating System`
- Vault ID: `e2b86d4499ab2d0dcd8fc4aee921db25`
- Region: `North America`
- Encryption: `end-to-end`

## Why This Path

This Mac already runs background automation that writes directly into the vault. A headless sync client is the cleanest way to keep that vault synchronized online without depending on the Obsidian desktop UI being open.

## Important Rule

Obsidian's official docs warn not to use **desktop app Sync** and **Headless Sync** on the same device at the same time.

For this Mac, the intended setup is:

- use **Headless Sync** on this Mac
- do **not** enable the desktop app's own Sync plugin here
- on other devices, use normal Obsidian Sync in the Obsidian app

Source:

- [Headless Sync](https://help.obsidian.md/sync/headless)

## Installed Tools

Installed locally:

- `ob` via `obsidian-headless`

Helper files in this repository:

- continuous sync runner: [obsidian-sync-continuous.sh](../scripts/obsidian-sync-continuous.sh)
- launch agent installer: [install-obsidian-sync-launchagent.sh](../scripts/install-obsidian-sync-launchagent.sh)
- launch agent plist: [com.dbillor.voice-kb.obsidian-headless-sync.plist](../launchd/com.dbillor.voice-kb.obsidian-headless-sync.plist)

## One-Time Setup

1. Log into Obsidian Sync:

```bash
ob login
```

2. Either list an existing remote vault:

```bash
ob sync-list-remote
```

or create one:

```bash
ob sync-create-remote --name "Personal Operating System" --encryption e2ee
```

3. Link the local vault to the remote vault:

```bash
ob sync-setup \
  --vault "Personal Operating System" \
  --path "./vault" \
  --device-name "Denx Mac"
```

4. Run a one-time sync:

```bash
ob sync --path "./vault"
```

5. Install the background sync agent:

```bash
./scripts/install-obsidian-sync-launchagent.sh
```

## Useful Commands

Show sync status:

```bash
ob sync-status --path "./vault"
```

Run continuously in the foreground:

```bash
./scripts/obsidian-sync-continuous.sh
```

## Access Model

After setup:

- this Mac writes the vault locally
- Headless Sync keeps it synchronized online
- other Macs, iPhones, and iPads can open the same remote vault through Obsidian Sync

## Optional Publish Layer

If you later want a browser-readable wiki, add Obsidian Publish on top of this for a curated subset. Keep the main private vault synced through Obsidian Sync.
