# Using CI Launchpad

Back to the [README](../README.md).

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

## Usage tips

- **Tag management**: On known cards, click tag pills to toggle them. On discovered cards, input fields map directly to the workflow's YAML inputs.
- **Runner hover**: Hover over the runner dropdown to see the full template name.
- **QASE integration** (fleet-e2e): Toggle Report on/off, set a Run ID (blank = auto-create), toggle Complete Run.
- **User override**: Click the user name in the top bar to set a custom display name for the audit trail.
