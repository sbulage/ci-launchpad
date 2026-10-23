# Security

Back to the [README](README.md).

CI Launchpad can trigger real CI jobs with your GitHub credentials, so it is locked down by default.

## Protections in place

| Layer | What it does |
|-------|-------------|
| **Localhost only** | Server binds to `127.0.0.1` — not accessible from the network. The Docker image listens on `0.0.0.0` inside the container, and `docker-compose.yml` publishes it on the host's `127.0.0.1` only. |
| **Access key** | Every request (pages, API, triggers) needs the key from the startup link, then a `HttpOnly; SameSite=Strict` cookie. Without it: `403`. Only `/healthz` (returns `{"ok": true}`) is open, for the Docker health check. |
| **CSRF token** | A random 256-bit token is generated on each server start and injected into the page. Every POST request must include it in an `X-CSRF-Token` header — blocks cross-origin trigger attacks from malicious websites. |
| **Confirmation modal** | Before any trigger, a modal shows every workflow, all parameters, and the exact `gh` command that will run. You must explicitly click "Yes, trigger". |
| **Rate limiting** | Cooldown between trigger batches (default 30s, 10s–5min in settings) — prevents accidental double-fires. Enforced by the server, independently of the client. |
| **Idle session lock** | After inactivity (default 15 min, 0–60 min in settings or from the lock screen), the UI locks and disables all triggers. |
| **gh auth re-verification** | Every trigger re-checks the `gh` login before firing — catches expired tokens. |
| **Audit trail** | Every trigger is logged to `~/.ci-launchpad-triggers.json` with user, workflow, parameters, the full `gh` command, and timestamp. |

## What CI Launchpad does NOT do

- Does not store or handle GitHub tokens — it delegates to the `gh` CLI, which manages its own auth.
- Does not expose any port beyond localhost.
- Does not run any workflow without explicit user confirmation.
- Does not accept input from external sources — the CSRF token ensures only the served page can trigger.
