# CI Launchpad

A lightweight, local web dashboard for triggering GitHub Actions workflows — no dependencies beyond Python 3 and the `gh` CLI.

Built to replace the tedious GitHub UI workflow when you need to trigger multiple CI jobs across repos with different parameters.

## Quick start

```bash
git clone https://github.com/<your-user>/ci-launchpad.git
cd ci-launchpad
./server.py              # starts on http://localhost:8484
./server.py --port 9090  # custom port
```

Or run in the background:

```bash
nohup python3 server.py > /tmp/ci-launchpad.log 2>&1 &
fuser -k 8484/tcp        # stop it again
```

### Prerequisites

- Python 3.8+
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated: `gh auth login`

No `pip install`, no `npm`, no containers — zero dependencies.

## Examples

### Run the fleet-e2e suite on three Rancher versions at once

1. Load `rancher/fleet-e2e` (the default repo).
2. Tick the **2.16**, **2.15** and **2.14** cards, toggle tags like `@p0 @p1`.
3. `Ctrl+Enter` → check the commands in the modal → **Yes, trigger 3 workflow(s)**.

Each card becomes one `gh` call, e.g.:

```bash
gh workflow run ui-rm_head.yaml -R rancher/fleet-e2e --ref main \
  -f rancher_version=head/2.16 -f upstream_cluster_version=v1.37.1+k3s1 \
  -f grep_test_by_tag="@login @p0 @p1" -f destroy_runner=true
```

### Trigger another team's workflow on RKE2

1. Type `my-org/my-repo` in the Repo field → **Load** → pick the workflows you need.
2. An input such as `rke2_version: v1.34.11+rke2r1` shows a **K3s | RKE2** switch with RKE2 already selected.
3. Pick a newer version from the dropdown (or **Custom...**), select the card, trigger.

### Re-run a saved setup

Set up the cards once → **Favorites → + Save Current** → name it `nightly-216`. Next time, **Favorites → nightly-216** restores the selection and every parameter.

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

```bash
curl -s 'localhost:8484/api/cluster-versions?distro=rke2'    # {"versions": ["v1.37.1+rke2r1", ...]}
curl -s 'localhost:8484/api/branches?repo=rancher/fleet-e2e' # {"branches": ["main", "release-2.x", ...]}
curl -s 'localhost:8484/api/trigger-log'                     # your audit log
```

## Features

### Workflow management

- **Known repos**: `rancher/fleet-e2e` has pre-configured workflow cards with curated tags, QASE integration, and runner templates. Add your own in `KNOWN_WORKFLOWS` in `config.py`.
- **Discovered repos**: Enter any repo — CI Launchpad fetches its workflows and parses `workflow_dispatch` inputs from the YAML files. Boolean inputs render as toggle switches, `choice` inputs as dropdowns of their declared options, strings as text fields.
- **K3s / RKE2 versions**: A discovered string input that looks like a cluster version (default like `v1.34.11+rke2r1` / `v1.36.4+k3s1`, or `rke2`/`k3s` in its name or description) gets a **K3s | RKE2** switch plus a dropdown of the newest 3 stable releases per minor, fetched from `k3s-io/k3s` / `rancher/rke2` (cached 1h). Inputs with no default offer **(workflow default)**, which sends nothing. Add more distros in `CLUSTER_DISTROS` in `config.py`.
  - fleet-e2e's own workflows install K3s only, so their known cards keep a K3s dropdown; the Hardening card adds an RKE2 dropdown limited to the versions its provisioning script supports.
- **Workflow picker**: When loading a discovered repo, choose which workflows to fetch inputs for — saves time on repos with many workflows.
- **Add more later**: Click the **+** button next to the workflow count to add workflows you skipped initially.
- **Branch picker**: Type the ref to run on, or click the refresh button next to it to load the repo's branches as suggestions.
- **Cached on refresh**: Loaded workflows are cached in `localStorage` — page refresh restores them instantly without re-fetching. Click **Load** to re-fetch.

### Triggering

1. Select one or more workflow cards (click the header/checkbox).
2. Fill in parameters (version, tags, runner, etc.).
3. Click **Trigger Selected** (or press `Ctrl+Enter`).
4. Review the confirmation modal — shows every workflow, its parameters, and the exact `gh` command.
5. Click **Yes, trigger** to fire.

Multiple selected cards are sent as one batch, one second apart; the cooldown starts after the whole batch.

### Favorites

Save the current card selection and parameters under a name from the **Favorites** menu, and load it back later in one click.

### Tabs

| Tab | What it shows |
|-----|---------------|
| **Trigger** | Workflow cards with parameter inputs |
| **Recent Runs** | Last 25 runs from GitHub Actions with status badges. Click a row to see the options it was triggered with. Optional 30s auto-refresh. |
| **Trigger History** | Local audit log of every trigger you've fired |

### Settings

The gear icon in the top bar opens the settings panel: theme (light / dark / system), idle-lock timeout, and trigger cooldown.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Enter` | Trigger selected workflows |
| `Ctrl+A` | Select all cards (outside text inputs) |
| `Esc` | Close the settings panel or confirmation modal |

## Security

CI Launchpad can trigger real CI jobs with your GitHub credentials, so it is locked down by default.

### Protections in place

| Layer | What it does |
|-------|-------------|
| **Localhost only** | Server binds to `127.0.0.1` — not accessible from the network |
| **CSRF token** | A random 256-bit token is generated on each server start and injected into the page. Every POST request must include it in an `X-CSRF-Token` header — blocks cross-origin trigger attacks from malicious websites. |
| **Confirmation modal** | Before any trigger, a modal shows every workflow, all parameters, and the exact `gh` command that will run. You must explicitly click "Yes, trigger". |
| **Rate limiting** | Cooldown between trigger batches (default 30s, 10s–5min in settings) — prevents accidental double-fires. Enforced by the server, independently of the client. |
| **Idle session lock** | After inactivity (default 15 min, 0–60 min in settings or from the lock screen), the UI locks and disables all triggers. |
| **gh auth re-verification** | Every trigger re-checks the `gh` login before firing — catches expired tokens. |
| **Audit trail** | Every trigger is logged to `~/.ci-launchpad-triggers.json` with user, workflow, parameters, the full `gh` command, and timestamp. |

### What CI Launchpad does NOT do

- Does not store or handle GitHub tokens — it delegates to the `gh` CLI, which manages its own auth.
- Does not expose any port beyond localhost.
- Does not run any workflow without explicit user confirmation.
- Does not accept input from external sources — the CSRF token ensures only the served page can trigger.

## Project structure

```text
ci-launchpad/
├── server.py          # HTTP server — API endpoints, CSRF, rate limiting
├── config.py          # Known workflow definitions, tags, runners, distros
├── static/
│   ├── index.html     # Page structure, modals, settings panel, lock overlay
│   ├── app.js         # Client logic — cards, picker, confirm flow, idle lock
│   └── style.css      # Dark/light/system themes, all component styles
└── README.md
```

## Configuration reference

### Server-side (`config.py`)

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

### Server-side (`server.py`)

| Setting | Default | Description |
|---------|---------|-------------|
| `TRIGGER_LOG` | `~/.ci-launchpad-triggers.json` | Audit log file. Keeps the last 200 entries. |
| Bind address | `127.0.0.1` | Hardcoded to localhost — not configurable, to prevent accidental network exposure. |
| CSRF token | Auto-generated | 256-bit random hex token, regenerated on every server restart. |

### Client-side (browser `localStorage`)

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

### Audit log

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

## Usage tips

- **Tag management**: On known cards, click tag pills to toggle them. On discovered cards, input fields map directly to the workflow's YAML inputs.
- **Runner hover**: Hover over the runner dropdown to see the full template name.
- **QASE integration** (fleet-e2e): Toggle Report on/off, set a Run ID (blank = auto-create), toggle Complete Run.
- **User override**: Click the user name in the top bar to set a custom display name for the audit trail.
