FROM mcr.microsoft.com/devcontainers/python:1-3.11-bullseye

RUN su vscode -c "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -" \
    && apt-get update \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/meme-ai
