#!/usr/bin/env python3
"""CI Launchpad — lightweight local server for triggering GitHub Actions.

Usage:
    ./server.py              # start on port 8484
    ./server.py --port 9090  # custom port
"""

import argparse
import base64
import http.cookies
import http.server
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from config import (
    PORT, DEFAULT_REPO, RUNNER_TEMPLATES, KNOWN_WORKFLOWS, CLUSTER_DISTROS,
    DEFAULT_COOLDOWN, MIN_COOLDOWN, MAX_COOLDOWN,
)

STATIC_DIR = Path(__file__).parent / "static"
TRIGGER_LOG = Path.home() / ".ci-launchpad-triggers.json"
KEY_FILE = Path.home() / ".ci-launchpad-key"
ACCESS_KEY = ""  # set in main()

_last_trigger_time = 0
_trigger_cooldown = DEFAULT_COOLDOWN
_active_batch_id = None
CSRF_TOKEN = secrets.token_hex(32)

# Cache for cluster versions per distro (1 hour TTL)
_cluster_version_cache = {}
CLUSTER_VERSION_CACHE_TTL = 3600

# Cache for branches (5 min TTL per repo)
_branch_cache = {}
BRANCH_CACHE_TTL = 300

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
}


def load_trigger_log():
    if TRIGGER_LOG.exists():
        return json.loads(TRIGGER_LOG.read_text())
    return []


def save_trigger_entry(user, workflow, params, cmd=None, branch="main"):
    log = load_trigger_log()
    entry = {
        "user": user,
        "workflow": workflow,
        "params": params,
        "branch": branch,
        "time": datetime.now(timezone.utc).isoformat(),
    }
    if cmd:
        entry["command"] = " ".join(cmd)
    log.insert(0, entry)
    TRIGGER_LOG.write_text(json.dumps(log[:200], indent=2))


def load_access_key():
    """Access key from CI_LAUNCHPAD_KEY, else the saved key file, else a new one saved for restarts."""
    key = os.environ.get("CI_LAUNCHPAD_KEY", "").strip()
    if key:
        return key
    if KEY_FILE.exists() and KEY_FILE.read_text().strip():
        return KEY_FILE.read_text().strip()
    key = secrets.token_urlsafe(24)
    fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key


def _key_matches(value):
    return bool(value) and secrets.compare_digest(value.encode(), ACCESS_KEY.encode())


def get_gh_user():
    try:
        r = subprocess.run(
            ["gh", "api", "user", "--jq", ".login,.name,.avatar_url"],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode == 0:
            lines = r.stdout.strip().split("\n")
            return {
                "login": lines[0] if len(lines) > 0 else "",
                "name": lines[1] if len(lines) > 1 else "",
                "avatar_url": lines[2] if len(lines) > 2 else "",
            }
    except Exception:
        pass
    return None


def _parse_workflow_inputs(yaml_text):
    """Minimal YAML parser for workflow_dispatch inputs (no PyYAML needed)."""
    inputs = []
    in_dispatch = False
    in_inputs = False
    current = None
    inputs_indent = None
    name_indent = None
    in_options = False

    for line in yaml_text.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if "workflow_dispatch:" in stripped:
            in_dispatch = True
            continue

        if in_dispatch and not in_inputs:
            if stripped == "inputs:":
                in_inputs = True
                inputs_indent = len(line) - len(line.lstrip())
                continue
            if not line.startswith(" ") and stripped.endswith(":"):
                in_dispatch = False
                continue

        if in_inputs:
            line_indent = len(line) - len(line.lstrip())
            if line_indent <= inputs_indent and stripped:
                in_inputs = False
                in_dispatch = False
                if current:
                    inputs.append(current)
                    current = None
                continue

            if in_options and stripped.startswith("- ") and current:
                current["options"].append(stripped[2:].strip().strip("'\""))
                continue
            in_options = False

            if ":" in stripped:
                key_part = stripped.split(":")[0].strip()
                val_part = stripped[stripped.index(":") + 1:].strip().strip("'\"")

                if name_indent is not None and line_indent > name_indent:
                    if current and key_part == "options":
                        current["options"] = []
                        in_options = True
                    elif current and key_part == "description":
                        current["description"] = val_part
                    elif current and key_part == "default":
                        current["default"] = val_part
                    elif current and key_part == "type":
                        current["type"] = val_part
                else:
                    if name_indent is None:
                        name_indent = line_indent
                    if line_indent == name_indent:
                        if current:
                            inputs.append(current)
                        current = {"name": key_part, "default": "", "type": "string", "description": ""}

    if current:
        inputs.append(current)

    return inputs


def _fetch_workflow_yaml(repo, path):
    try:
        r = subprocess.run(
            ["gh", "api", f"repos/{repo}/contents/{path}", "--jq", ".content"],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode == 0 and r.stdout.strip():
            return base64.b64decode(r.stdout.strip()).decode("utf-8", errors="replace")
    except Exception:
        pass
    return None


def list_workflows_for_repo(repo):
    """Fast: just list workflows without fetching YAML."""
    known = KNOWN_WORKFLOWS.get(repo)
    if known:
        return known, True

    try:
        r = subprocess.run(
            ["gh", "workflow", "list", "-R", repo, "--json", "name,id,path,state"],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode != 0:
            return None, False
        wfs = json.loads(r.stdout)
        result = []
        for wf in wfs:
            if wf.get("state") != "active":
                continue
            wf_path = wf.get("path", "")
            if wf_path.startswith("dynamic/"):
                continue
            fname = os.path.basename(wf_path)
            result.append({
                "file": fname,
                "path": wf_path,
                "label": wf.get("name", fname),
                "discovered": True,
            })
        return result, False
    except Exception:
        return None, False


def enrich_workflow(repo, wf_path):
    """Fetch a single workflow's YAML and parse its dispatch inputs."""
    yaml_text = _fetch_workflow_yaml(repo, wf_path)
    return _parse_workflow_inputs(yaml_text) if yaml_text else []


_STABLE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)\+(?:k3s|rke2r)(\d+)$")


def fetch_cluster_versions(distro):
    """Fetch recent stable release tags for a distro (newest 3 per minor), cached for 1 hour."""
    now = time.time()
    cached = _cluster_version_cache.get(distro)
    if cached and now - cached["fetched_at"] < CLUSTER_VERSION_CACHE_TTL:
        return cached["versions"]

    try:
        # RKE2 publishes several -rcN tags per release, so fetch a full page
        r = subprocess.run(
            ["gh", "api", f"repos/{CLUSTER_DISTROS[distro]}/releases?per_page=100",
             "--jq", ".[].tag_name"],
            capture_output=True, text=True, timeout=20,
        )
        if r.returncode == 0:
            # Releases are listed by publish date, not version — sort explicitly
            versions = {}
            for tag in r.stdout.split():
                m = _STABLE_TAG.match(tag)
                if m:
                    versions[tag] = tuple(int(p) for p in m.groups())
            seen = {}
            for tag in sorted(versions, key=versions.get, reverse=True):
                bucket = seen.setdefault(versions[tag][:2], [])
                if len(bucket) < 3:
                    bucket.append(tag)
            result = [tag for bucket in seen.values() for tag in bucket]
            _cluster_version_cache[distro] = {"versions": result, "fetched_at": now}
            return result
    except Exception:
        pass
    return cached["versions"] if cached else []


def fetch_branches(repo):
    """Fetch repo branches, cached 5 minutes per repo."""
    now = time.time()
    cached = _branch_cache.get(repo)
    if cached and now - cached["fetched_at"] < BRANCH_CACHE_TTL:
        return cached["branches"]

    try:
        r = subprocess.run(
            ["gh", "api", f"repos/{repo}/branches?per_page=30",
             "--jq", ".[].name"],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode == 0:
            branches = [b.strip() for b in r.stdout.strip().split("\n") if b.strip()]
            _branch_cache[repo] = {"branches": branches, "fetched_at": now}
            return branches
    except Exception:
        pass
    return cached["branches"] if cached else ["main"]


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    # ── Access key: ?key=<key> once, then remembered in a cookie ──

    def _cookie_name(self):
        # cookies ignore ports — include it so two instances don't clash
        return f"ci_lp_key_{self.server.server_address[1]}"

    def _authorized(self, qs):
        self._set_cookie = False
        if _key_matches(qs.get("key", [""])[0]):
            self._set_cookie = True
            return True
        try:
            morsel = http.cookies.SimpleCookie(self.headers.get("Cookie", "")).get(self._cookie_name())
        except http.cookies.CookieError:
            return False
        return morsel is not None and _key_matches(morsel.value)

    def end_headers(self):
        if getattr(self, "_set_cookie", False):
            self.send_header("Set-Cookie", f"{self._cookie_name()}={ACCESS_KEY}; Path=/; "
                             "HttpOnly; SameSite=Strict; Max-Age=31536000")
        super().end_headers()

    def _deny(self):
        body = ("<h3>CI Launchpad: access key required</h3>"
                "<p>Open the link printed when the server started "
                "(Docker: <code>docker compose logs ci-launchpad</code>).</p>").encode()
        self.send_response(403)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json_response(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path, content_type=None):
        if not path.exists():
            self.send_error(404)
            return
        data = path.read_bytes()
        if not content_type:
            content_type = MIME_TYPES.get(path.suffix, "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_index(self):
        html = (STATIC_DIR / "index.html").read_text()
        html = html.replace("RUNNER_TEMPLATES_JSON", json.dumps(RUNNER_TEMPLATES))
        html = html.replace("DEFAULT_REPO_JSON", json.dumps(DEFAULT_REPO))
        html = html.replace("CSRF_TOKEN_JSON", json.dumps(CSRF_TOKEN))
        html = html.replace("DEFAULT_COOLDOWN_JSON", json.dumps(_trigger_cooldown))
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/healthz":
            self._json_response(200, {"ok": True})
            return
        if not self._authorized(qs):
            self._deny()
            return

        if parsed.path == "/api/gh-user":
            user = get_gh_user()
            self._json_response(200, user or {"error": "not authenticated"})

        elif parsed.path == "/api/load-workflows":
            repo = qs.get("repo", [DEFAULT_REPO])[0]
            wfs, known = list_workflows_for_repo(repo)
            if wfs is None:
                self._json_response(200, {
                    "error": f"Could not load workflows for {repo}. Check repo name and gh auth.",
                })
            else:
                self._json_response(200, {"workflows": wfs, "known": known})

        elif parsed.path == "/api/enrich-workflow":
            repo = qs.get("repo", [DEFAULT_REPO])[0]
            wf_path = qs.get("path", [""])[0]
            if not wf_path:
                self._json_response(400, {"error": "path is required"})
            else:
                inputs = enrich_workflow(repo, wf_path)
                self._json_response(200, {"dispatch_inputs": inputs})

        elif parsed.path == "/api/runs":
            repo = qs.get("repo", [DEFAULT_REPO])[0]
            self._handle_runs(repo)

        elif parsed.path == "/api/trigger-log":
            self._json_response(200, {"log": load_trigger_log()})

        elif parsed.path == "/api/cluster-versions":
            distro = qs.get("distro", ["k3s"])[0]
            if distro not in CLUSTER_DISTROS:
                self._json_response(400, {"error": f"unknown distro: {distro}"})
            else:
                self._json_response(200, {"versions": fetch_cluster_versions(distro)})

        elif parsed.path == "/api/branches":
            repo = qs.get("repo", [DEFAULT_REPO])[0]
            branches = fetch_branches(repo)
            self._json_response(200, {"branches": branches})

        elif parsed.path == "/api/settings":
            self._json_response(200, {
                "cooldown": _trigger_cooldown,
                "min_cooldown": MIN_COOLDOWN,
                "max_cooldown": MAX_COOLDOWN,
            })

        elif parsed.path.startswith("/static/"):
            rel = parsed.path[len("/static/"):]
            safe = Path(rel).name
            self._serve_file(STATIC_DIR / safe)

        else:
            self._serve_index()

    def do_POST(self):
        if not self._authorized({}):
            self._deny()
            return
        csrf = self.headers.get("X-CSRF-Token", "")
        if not secrets.compare_digest(csrf, CSRF_TOKEN):
            self._json_response(403, {"ok": False, "error": "Invalid CSRF token — reload the page"})
            return

        if self.path == "/api/trigger":
            self._handle_trigger()
        elif self.path == "/api/settings":
            self._handle_settings()
        else:
            self._json_response(404, {"error": "not found"})

    def _handle_settings(self):
        global _trigger_cooldown
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        cd = body.get("cooldown")
        if cd is not None:
            cd = max(MIN_COOLDOWN, min(MAX_COOLDOWN, int(cd)))
            _trigger_cooldown = cd
        self._json_response(200, {"ok": True, "cooldown": _trigger_cooldown})

    def _handle_trigger(self):
        global _last_trigger_time, _active_batch_id

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))

        batch_id = body.get("batch_id")
        now = time.time()

        if batch_id:
            if _active_batch_id and _active_batch_id != batch_id:
                self._json_response(429, {
                    "ok": False,
                    "error": "Another batch is in progress",
                    "retry_after": int(_trigger_cooldown),
                })
                return
            _active_batch_id = batch_id
        else:
            wait = _trigger_cooldown - (now - _last_trigger_time)
            if wait > 0:
                self._json_response(429, {
                    "ok": False,
                    "error": f"Rate limited — wait {int(wait)}s before triggering again",
                    "retry_after": int(wait),
                })
                return

        auth = get_gh_user()
        if not auth:
            self._json_response(401, {
                "ok": False, "error": "gh authentication expired — run 'gh auth login'",
            })
            return

        wf_file = body.get("file", "")
        label = body.get("label", wf_file)
        params = body.get("params", {})
        user = body.get("user", "unknown")
        repo = body.get("repo", DEFAULT_REPO)
        branch = body.get("branch", "main")

        cmd = ["gh", "workflow", "run", wf_file, "-R", repo, "--ref", branch]
        for k, v in params.items():
            if v:
                cmd += ["-f", f"{k}={v}"]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                _last_trigger_time = time.time()
                is_batch_last = body.get("batch_last", False)
                if is_batch_last:
                    _active_batch_id = None
                save_trigger_entry(user, label, params, cmd, branch)
                self._json_response(200, {"ok": True})
            else:
                err = result.stderr.strip() or result.stdout.strip()
                self._json_response(200, {"ok": False, "error": err})
        except Exception as e:
            self._json_response(500, {"ok": False, "error": str(e)})

    def _handle_runs(self, repo):
        cmd = [
            "gh", "run", "list", "-R", repo, "--limit", "25",
            "--json", "name,status,conclusion,headBranch,createdAt,databaseId",
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            runs = json.loads(result.stdout) if result.returncode == 0 else []
            self._json_response(200, {"runs": runs, "triggerLog": load_trigger_log()})
        except Exception as e:
            self._json_response(500, {"error": str(e)})


def main():
    # show the startup link immediately even when stdout is a log file (nohup, docker)
    sys.stdout.reconfigure(line_buffering=True)
    parser = argparse.ArgumentParser(description="CI Launchpad server")
    parser.add_argument("--port", type=int, default=PORT)
    # Only change for containers (0.0.0.0) — publish the port on 127.0.0.1 there
    parser.add_argument("--host", default=os.environ.get("CI_LAUNCHPAD_HOST", "127.0.0.1"))
    args = parser.parse_args()

    global ACCESS_KEY
    ACCESS_KEY = load_access_key()
    user = get_gh_user()
    server = http.server.HTTPServer((args.host, args.port), Handler)

    print(f"\033[1;32m  CI Launchpad running at http://localhost:{args.port}/?key={ACCESS_KEY}\033[0m")
    if args.host != "127.0.0.1":
        print(f"  Listening on {args.host} — keep it off the network (docker: -p 127.0.0.1:{args.port}:{args.port})")
    if user:
        print(f"  Logged in as: {user['name'] or user['login']} (@{user['login']})")
    else:
        print(f"  \033[1;33mWarning: gh not authenticated — run 'gh auth login'\033[0m")
    print(f"  Press Ctrl+C to stop\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
