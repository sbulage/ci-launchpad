FROM python:3.13-slim

# gh CLI from GitHub's official apt repo
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 launchpad
WORKDIR /app
COPY server.py config.py ./
COPY static/ static/

# Home holds the trigger audit log — mount a volume there to keep it
USER launchpad
VOLUME /home/launchpad
ENV PYTHONUNBUFFERED=1 \
    CI_LAUNCHPAD_HOST=0.0.0.0
EXPOSE 8484

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8484/healthz', timeout=3)"

ENTRYPOINT ["python", "server.py"]
