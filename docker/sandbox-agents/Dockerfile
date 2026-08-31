FROM node:24-bookworm-slim

ARG OPENCODE_VERSION=1.18.23
ARG QWEN_CODE_VERSION=0.22.3

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global \
      "opencode-ai@${OPENCODE_VERSION}" \
      "@qwen-code/qwen-code@${QWEN_CODE_VERSION}" \
    && npm cache clean --force

ENV CI=true \
    HOME=/tmp/home \
    XDG_CONFIG_HOME=/tmp/config \
    XDG_DATA_HOME=/tmp/data \
    XDG_CACHE_HOME=/tmp/cache

WORKDIR /workspace
USER node

CMD ["node", "--version"]
