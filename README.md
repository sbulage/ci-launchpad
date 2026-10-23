# CI Launchpad

A lightweight, local web dashboard for triggering GitHub Actions workflows — no dependencies beyond Python 3 and the `gh` CLI.

Built to replace the tedious GitHub UI workflow when you need to trigger multiple CI jobs across repos with different parameters.

## Installation

The quickest way, with only Docker and a GitHub token:

```bash
docker run -d --name ci-launchpad --restart unless-stopped \
  -p 127.0.0.1:8484:8484 \
  -e GH_TOKEN=$(gh auth token) \
  -v ci-launchpad-data:/home/launchpad \
  ghcr.io/sbulage/ci-launchpad:latest

docker logs ci-launchpad    # → open the http://localhost:8484/?key=... link once
```

See **[INSTALL.md](INSTALL.md)** for all options (build the image yourself, Docker Compose, from source), updating, tokens, and how it stays private.

## What it does

- **Trigger many workflows at once.** Tick cards, press `Ctrl+Enter`, check the exact `gh` commands, confirm.
- **fleet-e2e ready.** Curated cards for every Rancher version with tags, runner and QASE options.
- **Any repo.** Load another repo and its `workflow_dispatch` inputs become a form, including a K3s / RKE2 version picker.
- **Favorites.** Save a selection with all its parameters and restore it in one click.
- **Runs and history.** Recent GitHub Actions runs with the options they were started with, plus a local audit log.
- **Safe by default.** Localhost only, access key, confirmation, cooldown, idle lock.

## Documentation

| Read | For |
|------|-----|
| [INSTALL.md](INSTALL.md) | All install options, updating, tokens |
| [docs/USAGE.md](docs/USAGE.md) | Examples, features, tabs, keyboard shortcuts, tips |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Adding your own repos, local API, project structure, all settings |
| [SECURITY.md](SECURITY.md) | Every protection and what the app does not do |
