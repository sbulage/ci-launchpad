# Configuring CI Launchpad

Back to the [README](../README.md).

## Customizing

### Make your own repo "known"

Add curated cards in `config.py`:

```python
KNOWN_WORKFLOWS["my-org/my-repo"] = [
    {
        "file": "e2e.yaml", "label": "E2E (main)",
        "rancher_version": "head/2.16", "k3s_version": "v1.37.1+k3s1",
        "tags": "@smoke", "available_tags": ["@smoke", "@full"],
        "runner_template": RUNNER_TEMPLATES[0]["value"],
        "qase_report": False, "qase_run_id": "", "qase_complete_run": False,
        "extras": {},
    },
]
```

### Query the local API

Pass the access key as `key=` (`cat ~/.ci-launchpad-key`, or from the startup link):

```bash
KEY=$(cat ~/.ci-launchpad-key)
curl -s "localhost:8484/api/cluster-versions?distro=rke2&key=$KEY"    # {"versions": ["v1.37.1+rke2r1", ...]}
curl -s "localhost:8484/api/branches?repo=rancher/fleet-e2e&key=$KEY" # {"branches": ["main", "release-2.x", ...]}
curl -s "localhost:8484/api/trigger-log?key=$KEY"                     # your audit log
```

## Project structure

```text
ci-launchpad/
├── server.py          # HTTP server — API endpoints, CSRF, rate limiting
├── config.py          # Known workflow definitions, tags, runners, distros
├── static/
│   ├── index.html     # Page structure, modals, settings panel, lock overlay
│   ├── app.js         # Client logic — cards, picker, confirm flow, idle lock
│   └── style.css      # Dark/light/system themes, all component styles
├── Dockerfile         # python:slim + gh CLI, non-root
├── docker-compose.yml # localhost-only port, GH_TOKEN, data volume
├── .github/workflows/
│   └── docker.yml     # builds and pushes the image to ghcr.io
├── docs/
│   ├── USAGE.md       # examples, features, shortcuts
│   └── CONFIGURATION.md # this file
├── INSTALL.md         # installation options, updating, tokens
├── SECURITY.md        # protections
└── README.md
```

## Configuration reference

Click a section to expand it.

<details>
<summary><b>Server-side (<code>config.py</code>)</b></summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8484` | HTTP port the server listens on. Can also be overridden at launch with `--port`. |
| `DEFAULT_REPO` | `rancher/fleet-e2e` | Repo loaded on first visit. |
| `DEFAULT_COOLDOWN` | `30` (seconds) | Initial trigger cooldown; adjustable in the settings panel. |
| `MIN_COOLDOWN` / `MAX_COOLDOWN` | `10` / `300` | Bounds the server enforces on the cooldown. |
| `RUNNER_TEMPLATES` | Spot, Dedicated | `{value, label}` dicts for the Runner dropdown on known cards. Values must match the workflows' `runner_template` options. |
| `CLUSTER_DISTROS` | `k3s`, `rke2` | Distro → GitHub releases repo used for version dropdowns. |
| `TAGS_215_PLUS` / `TAGS_PRE_215` | 8 / 7 tags | Tag pills for Rancher 2.15+ / pre-2.15 cards (`@appco` is 2.15+ only). |
| `UPGRADE_TAGS` / `HARDENING_TAGS` | | Tag pills for the Upgrade / Hardening cards. |
| `KNOWN_WORKFLOWS` | `rancher/fleet-e2e`, 9 workflows | Dict of `repo → workflow list`. Each workflow has file, label, default params, tags, QASE settings, and extras. Add entries to make other repos "known" with curated cards. |

</details>

<details>
<summary><b>Server-side (<code>server.py</code>)</b></summary>

| Setting | Default | Description |
|---------|---------|-------------|
| `TRIGGER_LOG` | `~/.ci-launchpad-triggers.json` | Audit log file. Keeps the last 200 entries. |
| Access key | `~/.ci-launchpad-key` | Generated on first start (file mode `600`) and reused. `CI_LAUNCHPAD_KEY` env var overrides it. |
| Bind address | `127.0.0.1` | `--host` flag or `CI_LAUNCHPAD_HOST` env var. Only meant for containers (`0.0.0.0`); never expose it on a network interface. |
| CSRF token | Auto-generated | 256-bit random hex token, regenerated on every server restart. |

</details>

<details>
<summary><b>Client-side (browser <code>localStorage</code>)</b></summary>

Set through the UI — no file editing needed.

| Key | Default | Set from |
|-----|---------|----------|
| `ci-lp-theme` | `dark` | Settings panel |
| `ci-lp-idle-timeout` | `15` (minutes) | Settings panel or lock screen. `0` = never lock. |
| `ci-lp-cooldown` | `DEFAULT_COOLDOWN` | Settings panel |
| `ci-lp-repo` | `DEFAULT_REPO` | Repo input field |
| `ci-lp-branch` | `main` | Branch input field |
| `ci-lp-user-override` | *(empty — uses gh name)* | Editable name field in the top bar |
| `ci-lp-presets` | *(empty)* | Favorites menu |
| `ci-lp-workflows` / `ci-lp-workflows-repo` | *(empty)* | Auto-cached after loading workflows |

</details>

<details>
<summary><b>Audit log</b></summary>

Each entry in `~/.ci-launchpad-triggers.json` looks like:

```json
{
  "user": "Octo Cat",
  "workflow": "2.16 (head)",
  "params": { "rancher_version": "head/2.16", "grep_test_by_tag": "@login @p0" },
  "branch": "main",
  "command": "gh workflow run ui-rm_head.yaml -R rancher/fleet-e2e --ref main -f rancher_version=head/2.16 ...",
  "time": "2026-09-11T10:30:00+00:00"
}
```

</details>
