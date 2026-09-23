import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

import {
  AccountStorePort,
  agentTypeModelDefinitions,
  EventLogPort,
  ENoticeTone,
  ESettingId,
  EUtilityModelRole,
  IdPort,
  DecisionPort,
  JudgePort,
  ModelPort,
  NOTICE_WARN_MS,
  parseRef,
  textValueOf,
  type CapabilitiesSource,
  type NoticePort,
} from '@dltech/atlas-core'

import { AgentRegistryPort } from '../agents/registry/port'
import { bindAgentTypes } from '../agents/types/bind-agent-types'
import { agentTypeSources } from '../agents/types/roots'
import { createUrlOpener } from '../browser/open-url'
import { createDeltaChannel } from '../channel/delta-channel'
import { createHarnessContainer } from '../container/create-harness-container'
import { disposeAll, registerDisposable } from '../container/disposal'
import { portToken, type DependencyContainer } from '../container/injection'
import {
  ClientVersionToken,
  HookMishapReporterToken,
  PrismaClientToken,
  SecretsStoreToken,
  WorkspaceRoot,
} from '../container/tokens'
import type { HookMishap } from '../hooks/budget'
import { HaikuJudge } from '../classifier/judge'
import { decisionsConfigFrom, RoutedJudge } from '../classifier/routed-judge'
import { JevDecisionClient } from '../classifier/jev-client'
import { JevJudge } from '../classifier/jev-judge'
import { FileBrowser } from '../files/file-browser'
import { TurnLedgerPort } from '../ledger/turn-ledger.port'
import { summaryFor } from '../model/summariser'
import { titleFor } from '../model/titler'
import { registerMcp } from '../mcp/registry/register-mcp'
import { createPendingQueues } from '../pending'
import { registerBuiltinPromptFragments } from '../prompt/register-prompt-fragments'
import { PromptRegistry } from '../prompt/registry'
import { ServiceRegistryPort } from '../services/service-registry'
import { ShellRegistryPort } from '../shells/shell-registry'
import { openAtlasDatabase } from '../store/database'
import { atlasDatabaseUrl, atlasDirectory } from '../store/paths'
import { ThreadStorePort } from '../store/thread-store'
import { ToolRegistry } from '../tools/registry'
import { probeWorkspace } from '../workspace/probe'
import type { ContributedSurface } from '../plugins/surface'

import { bindAccounts, bindKeychainSource } from './account-bindings'
import { dockerCapabilitiesSource } from './capabilities-source'
import type { Summariser } from './compact-turn'
import type { HarnessLaunch } from './config'
import { bindInstructionsAndMemory } from './context-bindings'
import { faultInjected } from './fault-injection'
import type { HarnessApp, HarnessStoreBinding, HarnessSurfaceBinding } from './harness-app'
import { mcpBootNotice } from './mcp-report'
import { knownRefs } from './model-catalogue'
import { bindModels } from './model-bindings'
import { bindSettingsPolicy } from './policy-bindings'
import { loadSessionPlugins } from './plugin-loading'
import { createUtilityModel } from './utility-model'
import { reachableRootsFor } from './reachable-files'
import { journalResume } from './resume-journal'
import type { ActiveConversation } from './resume-hint'
import type { SettingsBinding } from './settings-binding'
import { bindSkillRegistry, liveSkillRegistry } from './skills-binding'
import { wireTurn } from './turn-wiring'
import { claimLaunchWorktree, threadOpenedHandler } from './worktree-claims'

/**
 * A repo or native plugin's surface hook is opaque to the loader by design (see plugins/surface.ts)
 * — it returns whatever the composing app expects, and the loader never inspects it. `TPluginSurface`
 * is that app-chosen shape; `asPluginSurfaces` is the one place the loader's `unknown` is asserted
 * into it, so every other caller sees a properly typed `ContributedSurface<TPluginSurface>[]`
 * instead of reaching for its own cast.
 */
const asPluginSurfaces = <TPluginSurface>(
  surfaces: readonly ContributedSurface[],
): readonly ContributedSurface<TPluginSurface>[] =>
  surfaces as unknown as readonly ContributedSurface<TPluginSurface>[]

export async function composeHarness<TSurface = undefined, Command = never, TPluginSurface = unknown>(args: {
  launch: HarnessLaunch
  env: Record<string, string | undefined>
  settings: SettingsBinding
  clientVersion: string
  surface: HarnessSurfaceBinding<TSurface>
  stores?: HarnessStoreBinding | undefined
  /**
   * Rebinds credential-facing ports before anything resolves them. A serve session runs this to
   * swap the cloud proxies (which assume a user session) for its thread-scoped broker adapters;
   * it must run ahead of `bindAccounts`, which resolves the account store at boot.
   */
  bindPorts?: ((args: { container: DependencyContainer }) => void) | undefined
  capabilities?: CapabilitiesSource | undefined
  /**
   * The repo's normalized origin identity, when the caller already knows it: a serve session is
   * told it by the workspace spec (its own git may not answer), while a host session leaves this
   * undefined and the memory binding resolves it from the checkout's origin remote itself.
   */
  repoIdentity?: string | null | undefined
}): Promise<HarnessApp<TSurface, Command, TPluginSurface>> {
  const { launch, surface } = args
  const notice: NoticePort = surface.notice
  const container = createHarnessContainer()
  container.register(ClientVersionToken, { useValue: args.clientVersion })
  args.bindPorts?.({ container })
  // A session with no workspace (an orchestrator agent) anchors at the process directory: nothing
  // probes a repo, claims a worktree, or reads project instructions for it.
  const anchor = launch.cwd ?? process.cwd()
  const workspace =
    launch.cwd === undefined
      ? { workspace: anchor, repo: null }
      : await probeWorkspace({ cwd: anchor })
  await claimLaunchWorktree({ container, workspace })
  const mcp = await registerMcp({ container, cwd: anchor })

  for (const server of mcp.servers()) {
    const bootNotice = mcpBootNotice(server)
    if (bootNotice !== null) {
      notice.notify({
        key: `mcp:${server.spec.name}`,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: bootNotice,
      })
    }
  }

  const settings = args.settings.service
  const settled = settings.snapshot().resolution

  // The sandbox container is keyed to the session, not the project directory: two tiles working
  // the same checkout get isolated containers, and resuming a thread reattaches to its own.
  // Before any thread is open the key falls back to a per-process id.
  const preThreadSessionKey = randomUUID()
  let activeThread: ActiveConversation | null = null

  const launchValue = (id: ESettingId): string | undefined => {
    const held = textValueOf({ resolution: settled, id })
    return held.length === 0 ? undefined : held
  }

  registerBuiltinPromptFragments({ container })
  container.register(WorkspaceRoot, { useValue: workspace.workspace })

  bindKeychainSource({ container, launchValue })

  const accountStore = container.resolve(portToken(AccountStorePort))
  const { credentials, accounts, cloud, usage, rewarmSecrets } = await bindAccounts({
    container,
    env: args.env,
    notice,
    cloudUrl: launchValue(ESettingId.CloudUrl),
    clientVersion: args.clientVersion,
  })
  const secrets = container.resolve(SecretsStoreToken)
  args.settings.bindTo(container)

  await bindSettingsPolicy({ container, settings, workspace, credentials, cwd: anchor })
  await bindInstructionsAndMemory({
    container,
    settings,
    repoRoot: workspace.repo ?? workspace.workspace,
    repoIdentity: args.repoIdentity,
  })

  const {
    models,
    model,
    modelPinned,
    executionLocation,
    executionPinned,
    sandbox,
    containerStatus,
    mounts,
  } = await bindModels({
    container,
    launch,
    anchor,
    sessionKey: () => activeThread?.threadId ?? preThreadSessionKey,
    settled,
    settings,
    credentials,
    accountList: await accountStore.list(),
    notice,
    env: args.env,
  })

  const database = await openAtlasDatabase({
    databaseUrl: launchValue(ESettingId.DatabaseUrl) ?? atlasDatabaseUrl(),
  })
  container.register(PrismaClientToken, { useValue: database.prisma })
  registerDisposable({ container, close: database.close })

  const skillRegistry = bindSkillRegistry({
    container,
    registry: await liveSkillRegistry({
      atlasHome: atlasDirectory(),
      home: homedir(),
      cwd: anchor,
    }),
  })

  const agentTypes = await bindAgentTypes({
    container,
    sources: await agentTypeSources({
      atlasHome: atlasDirectory(),
      home: homedir(),
      cwd: anchor,
    }),
    reachableModelIds: knownRefs(models),
    modelIsUsable: (modelId) => {
      const ref = parseRef(modelId)
      return ref !== undefined && models.cardFor(ref) !== undefined
    },
    subagentModelId: launchValue(ESettingId.SubagentModel),
  })

  settings.register(
    agentTypeModelDefinitions({ typeNames: agentTypes.types.map((type) => type.name) }),
  )

  const decisionsConfig = decisionsConfigFrom({ settings, secrets })
  const decisions = new JevDecisionClient({ config: decisionsConfig })
  container.register(portToken(DecisionPort), { useValue: decisions })

  container.register(portToken(JudgePort), {
    useValue: new RoutedJudge({
      fallback: new HaikuJudge({
        model: createUtilityModel({
          role: EUtilityModelRole.Judge,
          settings,
          catalogue: models,
          notice,
        }),
      }),
      jev: new JevJudge({ decisions }),
      enabled: () => decisionsConfig() !== undefined,
    }),
  })

  if (args.stores !== undefined) await args.stores.bind({ container })

  /**
   * Plugin loading resolves `EventLogPort`/`ThreadStorePort`/`TurnLedgerPort` for the host it hands
   * a repo plugin, so it has to run after `stores.bind` has had its chance to override them — a
   * serve session's plugins would otherwise be handed the default `PrismaClientToken`-backed
   * stores, or fail outright before `PrismaClientToken` is even registered. It still has to run
   * before `surface.bind` and before `ToolRegistry`/`HookChain` first resolve.
   */
  const plugins = await loadSessionPlugins({ container, cwd: anchor, atlasHome: atlasDirectory(), notice })

  const log = container.resolve(portToken(EventLogPort))
  const ids = container.resolve(portToken(IdPort))
  const threads = container.resolve(portToken(ThreadStorePort))
  const ledger = container.resolve(portToken(TurnLedgerPort))

  container.register(HookMishapReporterToken, {
    useValue: (mishap: HookMishap) =>
      notice.notify({
        key: `hook:${mishap.label}`,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: `hook ${mishap.label} ${mishap.detail}`,
      }),
  })

  const bound = surface.bind === undefined ? undefined : await surface.bind({ container })

  const tools = () => container.resolve(portToken(ToolRegistry)).declarations()
  const modelPort = faultInjected(container.resolve(portToken(ModelPort)))
  const prompts = container.resolve(portToken(PromptRegistry))
  const shells = container.resolve(portToken(ShellRegistryPort))
  const agents = container.resolve(portToken(AgentRegistryPort))
  const services = container.resolve(portToken(ServiceRegistryPort))

  const channel = createDeltaChannel()
  const pending = createPendingQueues<Command>()

  const titlerModel = createUtilityModel({
    role: EUtilityModelRole.Titler,
    settings,
    catalogue: models,
    notice,
  })
  const compactionModel = createUtilityModel({
    role: EUtilityModelRole.Compaction,
    settings,
    catalogue: models,
    notice,
  })
  const tldrModel = createUtilityModel({
    role: EUtilityModelRole.Tldr,
    settings,
    catalogue: models,
    notice,
  })

  const summarise: Summariser = ({ events, fromSeq, throughSeq, signal }) =>
    summaryFor({
      model: compactionModel,
      events,
      fromSeq,
      throughSeq,
      ...(signal === undefined ? {} : { signal }),
    })

  const { turn, runner, recordTeardownEndings } = wireTurn<Command>({
    container,
    workspace,
    executionLocation,
    capabilities:
      args.capabilities ?? dockerCapabilitiesSource({ executionLocation, cwd: anchor, env: args.env }),
    mounts,
    models,
    model,
    modelPort,
    prompts,
    declarations: tools,
    pending,
    channel,
    notice,
    summarise,
    settings,
    decisionsEnabled: () => decisionsConfig() !== undefined,
    stopSandbox: sandbox.stop,
    settled,
    tldr: { feed: surface.tldrFeed, model: tldrModel, modelId: () => tldrModel.modelId },
  })

  return {
    launch,
    workspace,
    tools: container.resolve(portToken(ToolRegistry)),
    markActiveThread: (active) => {
      activeThread = active
    },
    activeThread: () => activeThread,
    titler: ({ text, images, signal }) => titleFor({ model: titlerModel, text, images, signal }),
    summarise,
    settings,
    secrets,
    rewarmSecrets,
    skills: skillRegistry.all(),
    skillRegistry,
    agentTypes,
    files: new FileBrowser({
      root: anchor,
      reachableRoots: () =>
        reachableRootsFor({
          location: executionLocation.current(),
          projectDirectory: anchor,
          mounts,
        }),
    }),
    openUrl: createUrlOpener(),
    credentials,
    accounts,
    cloud,
    usage,
    channel,
    log,
    threads,
    ledger,
    ids,
    pending,
    shells,
    agents,
    services,
    sandbox,
    containerStatus,
    mcp: () => mcp.servers(),
    threadOpened: threadOpenedHandler({ container, log, threads, ids, notice }),
    journalResume: ({ active, directory }) =>
      journalResume({ active, command: launch.command, directory }),
    pluginProjections: plugins.projections,
    pluginSurfaces: asPluginSurfaces<TPluginSurface>(plugins.surfaces),
    model,
    modelPinned,
    models,
    executionLocation,
    executionPinned,
    surface: bound as TSurface,
    close: async () => {
      usage.dispose()
      await recordTeardownEndings().catch(() => undefined)
      await disposeAll({ container })
    },
    runner,
  }
}
