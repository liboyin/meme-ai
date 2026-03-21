FROM mcr.microsoft.com/devcontainers/python:3.13-bookworm

RUN rm -f /etc/apt/sources.list.d/yarn.list /usr/share/keyrings/yarn-archive-keyring.gpg \
    && su vscode -c "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -" \
    && apt-get update \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

ENV PATH="/workspaces/meme-ai/.venv/bin:${PATH}"

WORKDIR /workspaces/meme-ai
