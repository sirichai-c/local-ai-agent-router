FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

ENV CI=true \
    HOME=/tmp/home \
    npm_config_cache=/tmp/npm-cache

WORKDIR /workspace
USER node

CMD ["node", "--version"]
