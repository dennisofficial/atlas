# Base must stay trixie: bookworm's git 2.39 silently ignores the scoped safe.directory
# wildcards the harness injects via GIT_CONFIG_* env; trixie ships git 2.47.
# https://github.com/git/git/blob/v2.46.0/Documentation/config/safe.txt
FROM node:22-trixie-slim

# Browser-launch validations below run only on native builds: chrome dies under qemu when the
# arm64 variant is cross-built from amd64 CI (GPU process launch failures, target signal 5),
# while the downloads and installs work fine emulated.
ARG TARGETPLATFORM
ARG BUILDPLATFORM

ENV DEBIAN_FRONTEND=noninteractive \
    TERM=xterm \
    GIT_TERMINAL_PROMPT=0 \
    GIT_EDITOR=true \
    PAGER=cat \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep gnupg ca-certificates curl unzip xz-utils openssh-client build-essential \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable" \
      > /etc/apt/sources.list.d/docker.list \
  && apt-get update && apt-get install -y --no-install-recommends \
      docker-ce-cli docker-compose-plugin \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/* \
  && dpkg --compare-versions "$(git --version | awk '{print $3}')" ge 2.46 \
  && git --version \
  && rg --version >/dev/null \
  && gpg --version >/dev/null \
  && curl --version >/dev/null \
  && ssh -V \
  && unzip -v >/dev/null \
  && cc --version >/dev/null \
  && docker --version \
  && docker compose version \
  && gh --version

ARG PLAYWRIGHT_VERSION=1.61.1
# Baked ENV (unlike legacy v2) so every repo resolves the prebuilt browser with no download;
# /opt/playwright stays world-writable so a repo's own pinned playwright can add its build.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN mkdir -p /opt/playwright-runner /opt/playwright \
  && cd /opt/playwright-runner \
  && printf '{"name":"atlas-playwright-runtime","private":true}\n' > package.json \
  && npm install "playwright@${PLAYWRIGHT_VERSION}" \
  && ./node_modules/.bin/playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* \
  && chmod -R a+rwX /opt/playwright \
  && ./node_modules/.bin/playwright --version \
  && if [ "$TARGETPLATFORM" = "$BUILDPLATFORM" ]; then node -e "const{chromium}=require('/opt/playwright-runner/node_modules/playwright');chromium.launch({headless:true,args:['--no-sandbox']}).then(b=>b.close()).then(()=>console.log('chromium launch OK')).catch(e=>{console.error(e);process.exit(1)})"; fi

ARG PLAYWRIGHT_CLI_VERSION=0.1.20
# The agent CLI bundles its own playwright-core with its own browser revision, so it installs
# its browser itself into the shared browsers path; the playwright-runner build above does not
# satisfy it. Its default browser is the Google Chrome *channel* (an executable the image does
# not carry at /opt/google/chrome/chrome), so PLAYWRIGHT_MCP_BROWSER points bare
# `playwright-cli open` at the baked chromium build instead.
ENV PLAYWRIGHT_MCP_BROWSER=chromium
RUN mkdir -p /opt/playwright-cli \
  && cd /opt/playwright-cli \
  && printf '{"name":"atlas-playwright-cli","private":true}\n' > package.json \
  && npm install "@playwright/cli@${PLAYWRIGHT_CLI_VERSION}" \
  && ln -s /opt/playwright-cli/node_modules/.bin/playwright-cli /usr/local/bin/playwright-cli \
  && playwright-cli install-browser chrome-for-testing \
  && chmod -R a+rwX /opt/playwright /opt/playwright-cli \
  && playwright-cli --version \
  && if [ "$TARGETPLATFORM" = "$BUILDPLATFORM" ]; then playwright-cli open about:blank && playwright-cli close; fi \
  # the validation open above leaves a root-owned daemon socket dir that a non-root runtime
  # user cannot write into
  && rm -rf /tmp/pw-* /opt/playwright-cli/.playwright-cli

RUN curl -fsSL https://mise.jdx.dev/gpg-key.pub -o /tmp/mise-key.pub \
  && gpg --dearmor --yes -o /etc/apt/keyrings/mise-archive-keyring.gpg /tmp/mise-key.pub \
  && rm /tmp/mise-key.pub \
  && chmod a+r /etc/apt/keyrings/mise-archive-keyring.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.gpg arch=$(dpkg --print-architecture)] https://mise.jdx.dev/deb stable main" \
      > /etc/apt/sources.list.d/mise.list \
  && apt-get update && apt-get install -y --no-install-recommends mise \
  && rm -rf /var/lib/apt/lists/* \
  && mise --version

ENV MISE_DATA_DIR=/opt/mise
RUN mkdir -p /etc/mise \
  && printf '%s\n' \
      '[tools]' \
      'node = "lts"' \
      'python = "3"' \
      'bun = "latest"' \
      '' \
      '[settings]' \
      'idiomatic_version_file_enable_tools = ["node", "python", "bun"]' \
      'not_found_system_fallback = false' \
      'not_found_auto_install = false' \
      'trusted_config_paths = ["/"]' \
      > /etc/mise/config.toml \
  && mise install node@lts node@22 python@3 bun@latest \
  && chmod -R a+rwX /opt/mise

# Shims prepended via ENV because agent commands are non-interactive `sh -c` execs that read
# no profile; shims re-resolve versions from the cwd's version files at every invocation.
# /opt/corepack/bin is appended so a mise-resolved tool always wins over the corepack stubs.
ENV PATH=/opt/mise/shims:${PATH}:/opt/corepack/bin
# mise shims every binary in a tool's install, so node brings npm/npx/corepack shims that
# would shadow the packageManager-aware corepack stubs appended after them; the node base
# image likewise ships npm/npx at /usr/local/bin ahead of /opt/corepack/bin.
RUN rm -f /opt/mise/shims/npm /opt/mise/shims/npx /opt/mise/shims/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx \
  && mkdir -p /tmp/foreign-home \
  && node --version \
  && python --version \
  && python3 --version \
  && bun --version \
  && HOME=/tmp/foreign-home mise settings get idiomatic_version_file_enable_tools | grep -q node \
  && HOME=/tmp/foreign-home mise settings get idiomatic_version_file_enable_tools | grep -q python \
  && HOME=/tmp/foreign-home mise settings get idiomatic_version_file_enable_tools | grep -q bun \
  && HOME=/tmp/foreign-home mise settings get not_found_system_fallback | grep -qx false \
  && HOME=/tmp/foreign-home mise settings get not_found_auto_install | grep -qx false \
  && HOME=/tmp/foreign-home mise settings get trusted_config_paths | grep -qx '\["/"\]'

ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p /opt/corepack/bin \
  # the node base image ships yarn classic at /usr/local/bin, which would shadow the corepack stub
  && rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && rm -rf /opt/yarn-* \
  && corepack enable --install-directory /opt/corepack/bin yarn pnpm npm \
  # corepack < 0.31 fails pnpm/yarn signature verification since npm rotated its signing
  # keys on 2025-01-29; the node base must ship newer (https://github.com/nodejs/corepack/pull/614)
  && dpkg --compare-versions "$(corepack --version)" ge 0.31 \
  && corepack install -g yarn@stable pnpm@latest npm@latest \
  && chmod -R a+rwX /opt/corepack \
  && yarn --version \
  && pnpm --version \
  && npm --version

# Baked by sandbox-image.yml: the VCR image gets the real serve binary plus a `source:<sha>`
# stamp; the GHCR image gets 0-byte placeholders (docker sandboxes never run serve).
COPY atlas-serve /opt/atlas/atlas-serve
COPY atlas-serve.stamp /opt/atlas/atlas-serve.stamp
# /opt/atlas is 777, not 755: the sandbox session user (non-root) writes the serve
# token/lock/log files there at runtime, and a root-owned 755 dir would break the launcher.
RUN chmod 755 /opt/atlas/atlas-serve && chmod 777 /opt/atlas
