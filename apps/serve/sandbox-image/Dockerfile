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
      git git-lfs ripgrep gnupg ca-certificates curl unzip xz-utils openssh-client build-essential sudo procps \
      jq postgresql-client python3 \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable" \
      > /etc/apt/sources.list.d/docker.list \
  && apt-get update && apt-get install -y --no-install-recommends \
      docker-ce-cli docker-ce containerd.io docker-buildx-plugin docker-compose-plugin \
  # the container is the isolation boundary, so any sandbox user may sudo to root without a
  # password: privileged setup (playwright --with-deps, apt, the baked dockerd) runs from
  # non-interactive execs that can never answer a password prompt
  && printf 'ALL ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/atlas-sandbox \
  && chmod 0440 /etc/sudoers.d/atlas-sandbox \
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
  && ps --version >/dev/null \
  && ssh -V \
  && unzip -v >/dev/null \
  && cc --version >/dev/null \
  && docker --version \
  && docker compose version \
  && gh --version \
  && jq --version \
  && git lfs version \
  && psql --version

ARG LINEAR_CLI_VERSION=3.0.0
# schpet/linear-cli, the same CLI the operator runs on macOS; agents in sandboxes reach Linear
# with it. Direct binary download rather than the cargo-dist installer (1.6k lines of shell).
# The tarball ships one directory holding a single `linear` binary.
RUN arch="$(uname -m)" \
  && curl -fsSL "https://github.com/schpet/linear-cli/releases/download/v${LINEAR_CLI_VERSION}/linear-${arch}-unknown-linux-gnu.tar.xz" \
      -o /tmp/linear.tar.xz \
  && tar -xJf /tmp/linear.tar.xz -C /tmp \
  && install -m 0755 "/tmp/linear-${arch}-unknown-linux-gnu/linear" /usr/local/bin/linear \
  && rm -rf /tmp/linear.tar.xz "/tmp/linear-${arch}-unknown-linux-gnu" \
  && linear --version

ARG AWS_CLI_VERSION=2.37.10
# aws-cli v2 ships as a self-contained Linux installer; aarch64 and x86_64 are separate zips.
RUN arch="$(uname -m)" \
  && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}-${AWS_CLI_VERSION}.zip" \
      -o /tmp/awscliv2.zip \
  && unzip -q /tmp/awscliv2.zip -d /tmp \
  && /tmp/aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli --update \
  && rm -rf /tmp/awscliv2.zip /tmp/aws \
  && aws --version

ARG GCLOUD_VERSION=585.0.0
# google-cloud-cli is a python app. The tarball's install.sh exists to wire PATH and shell rc,
# both meaningless in a container — direct symlinks into /usr/local/bin do the same job.
# CLOUDSDK_PYTHON must name a real interpreter, not the mise shim: gcloud resolves python
# before any shim would run. trixie's python3 satisfies it.
RUN arch="$(uname -m)" \
  && case "$arch" in x86_64) garch=x86_64;; aarch64) garch=arm;; esac \
  && curl -fsSL "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-${GCLOUD_VERSION}-linux-${garch}.tar.gz" \
      -o /tmp/gcloud.tar.gz \
  && tar -xzf /tmp/gcloud.tar.gz -C /opt \
  && rm /tmp/gcloud.tar.gz \
  && for cmd in gcloud gsutil bq; do ln -s "/opt/google-cloud-sdk/bin/$cmd" "/usr/local/bin/$cmd"; done \
  && CLOUDSDK_PYTHON=/usr/bin/python3 gcloud --version \
  && CLOUDSDK_PYTHON=/usr/bin/python3 gsutil version >/dev/null \
  && CLOUDSDK_PYTHON=/usr/bin/python3 bq version

ARG DOCTL_VERSION=1.179.0
RUN arch="$(dpkg --print-architecture)" \
  && curl -fsSL "https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-${arch}.tar.gz" \
      -o /tmp/doctl.tar.gz \
  && tar -xzf /tmp/doctl.tar.gz -C /usr/local/bin doctl \
  && rm /tmp/doctl.tar.gz \
  && doctl version

ARG PULUMI_VERSION=3.268.0
# The pulumi tarball holds several language-host binaries; only `pulumi` goes on PATH, the rest
# are looked up next to it, so the whole set lands in /usr/local/bin.
RUN arch="$(uname -m)" \
  && case "$arch" in x86_64) parch=x64;; aarch64) parch=arm64;; esac \
  && curl -fsSL "https://get.pulumi.com/releases/sdk/pulumi-v${PULUMI_VERSION}-linux-${parch}.tar.gz" \
      -o /tmp/pulumi.tar.gz \
  && tar -xzf /tmp/pulumi.tar.gz -C /tmp \
  && install -m 0755 /tmp/pulumi/pulumi /usr/local/bin/pulumi \
  && install -m 0755 /tmp/pulumi/pulumi-language-* /usr/local/bin/ \
  && rm -rf /tmp/pulumi.tar.gz /tmp/pulumi \
  && pulumi version

ARG STRIPE_CLI_VERSION=1.53.0
# stripe-cli, for `stripe listen --forward-to` webhook forwarding in sandboxes.
# Release assets use x86_64/arm64, not uname's x86_64/aarch64.
RUN arch="$(uname -m)" \
  && case "$arch" in x86_64) sarch=x86_64;; aarch64) sarch=arm64;; esac \
  && curl -fsSL "https://github.com/stripe/stripe-cli/releases/download/v${STRIPE_CLI_VERSION}/stripe_${STRIPE_CLI_VERSION}_linux_${sarch}.tar.gz" \
      -o /tmp/stripe.tar.gz \
  && tar -xzf /tmp/stripe.tar.gz -C /usr/local/bin stripe \
  && rm /tmp/stripe.tar.gz \
  && stripe --version

ARG TERRAFORM_VERSION=1.16.5
RUN arch="$(uname -m)" \
  && case "$arch" in x86_64) tarch=amd64;; aarch64) tarch=arm64;; esac \
  && curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${tarch}.zip" \
      -o /tmp/terraform.zip \
  && unzip -o /tmp/terraform.zip terraform -d /usr/local/bin \
  && rm /tmp/terraform.zip \
  && terraform version

ARG CLOUDFLARED_VERSION=2026.10.0
# Single static binary, no package; the tunnel alternative the repos reach for over ngrok.
# Release assets use x86_64/arm64, not uname's x86_64/aarch64.
RUN arch="$(uname -m)" \
  && case "$arch" in x86_64) carch=x86_64;; aarch64) carch=arm64;; esac \
  && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${carch}" \
      -o /usr/local/bin/cloudflared \
  && chmod 755 /usr/local/bin/cloudflared \
  && cloudflared --version

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

ARG VERCEL_CLI_VERSION=62.7.0
# Dedicated prefix rather than npm -g: npm resolves its global prefix from the node it runs
# under, and node here is a mise shim whose prefix is off-PATH. /opt + a symlink is how the
# playwright-cli block above already solves the same problem.
RUN mkdir -p /opt/vercel-cli \
  && cd /opt/vercel-cli \
  && printf '{"name":"atlas-vercel-cli","private":true}\n' > package.json \
  && npm install "vercel@${VERCEL_CLI_VERSION}" \
  && ln -s /opt/vercel-cli/node_modules/.bin/vercel /usr/local/bin/vercel \
  && chmod -R a+rwX /opt/vercel-cli \
  && vercel --version

# Lazy docker-in-docker: /usr/local/bin/docker shadows the real docker-ce-cli at /usr/bin/docker
# and starts the baked daemon through sudo on first use. Baked for every image so the local docker
# sandbox (mounted host socket) stays a pass-through while a Vercel sandbox boots its own dockerd.
COPY docker-shim.sh /usr/local/bin/docker
COPY docker-daemon-up.sh /usr/local/bin/docker-daemon-up
RUN chmod 755 /usr/local/bin/docker /usr/local/bin/docker-daemon-up \
  && [ "$(command -v docker)" = "/usr/local/bin/docker" ] \
  && /usr/bin/docker --version

# Baked by sandbox-image.yml: the VCR image gets the real serve binary plus a version file the
# driver's drift probe matches against the pinned release and a protocol file that decides
# whether the sandbox is rotated; the GHCR image gets 0-byte placeholders (docker sandboxes never run serve).
COPY atlas-serve /opt/atlas/atlas-serve
COPY atlas-serve.version /opt/atlas/atlas-serve.version
COPY atlas-serve.protocol /opt/atlas/atlas-serve.protocol
# A fresh stamp per bake, so a republish can always mint a fresh manifest digest: Vercel caches a
# failed image optimization against the digest, and only a new digest retries it.
COPY atlas-serve.bake-id /opt/atlas/atlas-serve.bake-id
# /opt/atlas is 777, not 755: the sandbox session user (non-root) writes the serve
# token/lock/log files there at runtime, and a root-owned 755 dir would break the launcher.
RUN chmod 755 /opt/atlas/atlas-serve && chmod 777 /opt/atlas
