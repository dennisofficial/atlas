# R5 inventory: the `apps/api/src` tree

Slice R5 of `docs/slices/v1-retirement.md`, decision D10. One move: `src/api/platform/control`
becomes `src/api/platform/sessions`. No class, router alias or procedure name changes.

## What the tree is today

Before slice 4, `src/api` was "the v1 app" and `src/agent` "the v2 runtime" (`apps/api/AGENTS.md`
said so). Slice 4 deleted every v1 thread and sandbox lane. What is left in `src/api` is the tRPC
surface of Atlas Cloud, and `src/api/platform/control` is the module that composes the control
plane and serves sessions on it.

```
apps/api/src/
  _core/            kernel: env module, decorators, ports, types; imports nothing from the slices
    config/         EnvModule: the typed env service and its Joi schema
    decorators/     Nest parameter and method decorators shared by the routers
    errors/         the error types the tRPC error formatter maps
    http/           HTTP helpers shared by the REST controllers
    ports/          the ports the API binds (background work, job dispatcher, session verifier)
    types/          shared type declarations
  _lib/             infra adapters, framework-light
    background-work/  ProcessBackgroundWork: keeps promises alive to shutdown
    changes/          content stores for change and context payloads
    crypto/           CryptoModule: the secret cipher
    email/            the Resend client
    expo-push/        Expo push delivery
    http/             outbound HTTP helpers
    migrations/       the migration state reader behind /v1/health
    pod-resize/       pod resize request payloads
    redis/            RedisModule: the one Redis seam
    refresh-lock/     RefreshLockModule: one refresher per credential
    trigger/          TriggerModule: the JobDispatcher seam over trigger.dev
    version/          apiVersion()
  _module/          shared injectable modules
    client-version/   ClientVersionModule: the ClientVersionGuard
    session/          SessionModule: the session middleware and the SESSION_VERIFIER port
    trpc/             ApiTrpcModule: context, latency, throttle and error middlewares
  api/              ApiModule: the tRPC surface, in two layers
    platform/       identity, catalogue and session modules; never imports cloud
      accounts/         AccountsModule
      auth/             AuthModule: better-auth, account router
      classifier/       ClassifierModule: the commit classifier
      control/          ControlPlaneModule: the control plane and its session routers
      desktop-auth/     DesktopAuthModule: desktop sign-in handoff
      health/           HealthModule: /v1/health and the migration marker
      models/           ModelsModule: models.list and the Codex catalogue
      oauth-connections/ OauthConnectionsModule: provider connections used by the API
      previews/         PreviewsModule: preview tunnels and DNS
      provider-sign-in/ ProviderSignInModule: provider OAuth sign-in helpers
      usage/            UsageModule: usage reporting
    cloud/          per-feature cloud modules; may import platform
      agent-host/       agent host model config and repo helpers (no module of its own)
      agent37/          Agent37WebhookModule: the pod provider's webhook
      artifacts/        ArtifactsModule: artifact storage and publishing
      composer-uploads/ ComposerUploadsModule
      github/           GithubModule, GithubRealtimeModule: webhooks, PR state, fanout
      harness-secrets/  HarnessSecretsModule
      mcp-oauth/        McpOauthModule: cloud MCP OAuth grants
      mcp-servers/      McpServersModule
      memories/         MemoriesModule
      operator-input/   OperatorRequestsModule: the operator-input cards
      projects/         ProjectsModule
      secrets/          SecretsModule
      settings/         SettingsModule
      skill-catalogue/  SkillCatalogueModule
      skills/           SkillsModule
      ssh-signing-key/  SshSigningKeyModule
      stream/           SessionStreamModule, TerminalStreamModule
      thread-titling/   SessionTitlerModule, ThreadTitlingModule
      user-files/       UserFilesModule
  agent/            AgentModule: the agent host — claims sessions, wakes pods, runs the loop
    agent-tools/      the loop's tools
    analytics/        AnalyticsModule: ProductAnalytics
    bus/              Postgres change feed, Redis listeners, pod bus
    config/           agent host config readers
    control/          control-plane-backed settings: gateway key, image model, pod control
    diagrams/         the diagram repairer
    host/             ControlModule, CoreModule, HolderModule, HostCallsModule, HttpModule,
                      RuntimeModule, StartupModule
    http/             /healthz and /mcp-oauth/callback controllers
    mac-link/         MacLinkModule: the Mac app's link
    mcp-oauth/        the host's MCP OAuth helpers, read by `src/api`
    media/            media handling for the loop
    model/            model selection for the loop
    naming/           session title naming
    operator-input/   operator input inside a turn
    presence/         host presence rows
    runtime/          the turn runtime
    stream/           live frame publication
    testing/          test-only helpers the API shares
    tokens/           token minting for pods
    uploads/          user-layer uploads
    usage/            UsageModule: usage metering
  test/             cross-cutting specs: env alignment, the Bun runtime probe, boot
  app.module.ts     the root: ApiModule + AgentModule + HealthModule
  create-app.ts     composes the Nest app; never listens
  main.ts           the only entry
```

## Folders and files that name a generation

- `src/api/platform/control/` — D10 names it "the v2 surface". The name survives from the
  client ↔ control plane ↔ pod frame in which `src/api` was the v1 app and this folder was the v2
  session surface. It reads as a layer or as a generation rather than as the feature it holds
  (sessions, files, media, routines, services, terminal, notifications, drafts).
- `src/api/` — the name is honest: it is the tRPC API (`/v1/trpc`, `ApiModule`). It does not mark
  a generation, so R5 keeps it.
- Nothing else in the tree carries `v1`, `v2`, `legacy`, `old` or `next` in a folder or file name.
  `_core`, `_lib` and `_module` are kernel, adapters and shared modules, not generations.
- `src/agent` is kept by D10: it names the agent host.

## The move

| From                                 | To                                    | Reason                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/api/platform/control/` | `apps/api/src/api/platform/sessions/` | The folder is the session surface of the control plane. `platform/sessions` is free (the v1 folder of that name went in slice 4c), and the router inside it is already `sessions`. |

Kept on purpose: `ControlPlaneModule`, `controlPlaneProvider`, `ControlPlane` from
`@dltech/atlas-control`. "Control plane" is the glossary name for the tier that owns the record
(`CONTEXT.md`, `docs/architecture.md` §3); it names the service, not a generation. R5 renames no
class and no tRPC alias or procedure.

## What proves the move

- `packages/api-router/src/generated/server.ts` regenerated before and after: same aliases, same
  procedures, same order.
- `bun test` for the moved folder, the app-boot specs and the architecture boundaries.
- `git grep platform/control` returns history docs only.
