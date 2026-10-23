# Installing CI Launchpad

Back to the [README](README.md).

Pick one way:

| Way | Needs | Best for |
|-----|-------|----------|
| [1. Docker image](#1-docker-image-recommended) | Docker + a GitHub token | Most people. No clone, no build |
| [2. Build the image yourself](#2-build-the-image-yourself) | Docker + a GitHub token | When the published image isn't available |
| [3. Docker Compose](#3-docker-compose-from-a-clone) | Docker + a clone | Changing the code and running it in a container |
| [4. From source](#4-from-source) | Python 3.8+ and `gh` | No Docker |

Whichever way you pick, read [Token](#token) and [How it stays private](#how-it-stays-private).

## 1. Docker image (recommended)

```bash
docker run -d --name ci-launchpad --restart unless-stopped \
  -p 127.0.0.1:8484:8484 \
  -e GH_TOKEN=$(gh auth token) \
  -v ci-launchpad-data:/home/launchpad \
  ghcr.io/sbulage/ci-launchpad:latest

docker logs ci-launchpad    # → CI Launchpad running at http://localhost:8484/?key=...
```

Open that link once. The browser remembers the key, so plain <http://localhost:8484> works afterwards. The key is kept in the `ci-launchpad-data` volume, so the link stays the same across restarts and updates.

| Task | Command |
|------|---------|
| Update | `docker pull ghcr.io/sbulage/ci-launchpad:latest && docker rm -f ci-launchpad`, then the `docker run` above |
| Stop and remove | `docker rm -f ci-launchpad` (audit log and key stay in the volume) |
| Show the link again | `docker logs ci-launchpad` |
| Start fresh (new key, empty log) | `docker rm -f ci-launchpad && docker volume rm ci-launchpad-data`, then `docker run` |

## 2. Build the image yourself

Docker fetches the repo straight from GitHub. Nothing is cloned to your disk, and no intermediate containers are left behind:

```bash
docker build --pull --rm --force-rm -t ci-launchpad:latest \
  https://github.com/sbulage/ci-launchpad.git#main

# clean up leftovers: untagged (dangling) images and the build cache
docker image prune -f
docker builder prune -f
```

| Flag | Why |
|------|-----|
| `--pull` | Always start from the latest `python:3.13-slim` base |
| `--rm --force-rm` | Remove intermediate containers, even if the build fails |
| `…git#main` | Build from the `main` branch on GitHub |

Then use the `docker run` command from [way 1](#1-docker-image-recommended) with `ci-launchpad:latest` as the last line. To update, build again, `docker rm -f ci-launchpad`, and run again.

## 3. Docker Compose (from a clone)

```bash
git clone https://github.com/sbulage/ci-launchpad.git && cd ci-launchpad
GH_TOKEN=$(gh auth token) docker compose up -d --build
docker compose logs ci-launchpad    # → the link with the key
```

You can also put `GH_TOKEN=<token>` in a `.env` file next to `docker-compose.yml` (git-ignored). To use the published image instead of building, replace `build: .` / `image:` in `docker-compose.yml` with `image: ghcr.io/sbulage/ci-launchpad:latest`.

| Task | Command |
|------|---------|
| Update | `git pull && GH_TOKEN=$(gh auth token) docker compose up -d --build` |
| Stop | `docker compose down` (add `-v` to also delete the audit log and key) |
| Show the link again | `docker compose logs ci-launchpad` |
| New key | `docker compose down -v`, then start again, or set `CI_LAUNCHPAD_KEY` |

## 4. From source

Prerequisites:

- Python 3.8+
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated: `gh auth login`

No `pip install`, no `npm`, no containers. Zero dependencies.

```bash
git clone https://github.com/sbulage/ci-launchpad.git
cd ci-launchpad
./server.py              # prints http://localhost:8484/?key=... — open that link
./server.py --port 9090  # custom port
```

Or run it in the background:

```bash
nohup python3 server.py > /tmp/ci-launchpad.log 2>&1 &
grep -o 'http://[^ ]*' /tmp/ci-launchpad.log   # the link with the key
fuser -k 8484/tcp                              # stop it again
```

The key is saved in `~/.ci-launchpad-key`, so the link survives restarts. Delete the file to get a new one.

## Token

- **Docker (ways 1–3):** `$(gh auth token)` reuses your local `gh` login. Without `gh`, create a [personal access token](https://github.com/settings/tokens): classic with the `repo` scope, or fine-grained with *Actions: read & write* and *Contents: read* on the repos you trigger.
- **From source (way 4):** the app uses your `gh` login directly; no token to pass.
- **One instance per person.** Every trigger runs as the token's owner, so don't share one instance with the team. Run your own.
- **Data:** the audit log and the access key live in the `ci-launchpad-data` volume (Docker) or your home directory (from source). Favorites and settings live in your browser.

## How it stays private

Two simple layers, no extra setup:

1. **Localhost only.** The Docker commands publish the port as `127.0.0.1:8484`, and the source version binds to `127.0.0.1`, so nothing else on the network can connect. Don't change it to `-p 8484:8484`: Docker bypasses the host firewall, and anyone who can reach your machine could trigger CI as you.
2. **Access key.** Every page and API call needs the key from the startup link (like Jupyter Notebook). Even if the port does get exposed, a visitor without the key gets `403`.

See [SECURITY.md](SECURITY.md) for all protections.

## Publishing the image (maintainers)

The image is built and pushed to `ghcr.io/sbulage/ci-launchpad` by [`.github/workflows/docker.yml`](.github/workflows/docker.yml), only when run manually: *Actions → Docker image → Run workflow*.

- Run it from `main` for `:latest` (plus a `:sha-<short>` tag).
- Pick a `v*` tag under *Use workflow from* for a versioned image, e.g. `:1.0.0`.
- New GHCR packages are private. Make it public under *Package settings*, or users must `docker login ghcr.io` first.
