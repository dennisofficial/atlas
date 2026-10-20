import { homedir } from 'node:os'

import {
  EventLogPort,
  ESettingId,
  IdPort,
  LogPort,
  ModelPort,
  NoticePort,
  textValueOf,
  toThreadId,
  type ComposedPortBindings,
} from '@dltech/atlas-core'

import { AgentRegistryPort } from '../agents/registry/port'
import { OperatorInputPort } from '../operator-input/port'
import { createDeltaChannel } from '../channel/delta-channel'
import { bindCloudSettingsWriteThrough } from '../cloud/cloud-settings-write-through'
import { createHarnessContainer } from '../container/create-harness-container'
import { registeredPortToken, type DependencyContainer } from '../container/injection'
import {
  ClientVersionToken,
  CloudSettingsStoreToken,
  HookMishapReporterToken,
  SleepPreventionToken,
  WakeSignalToken,
} from '../container/tokens'
import { TurnLedgerPort } from '../ledger/turn-ledger.port'
import { createPendingQueues } from '../pending'
import { PromptRegistry } from '../prompt/registry'
import { ServiceRegistryPort } from '../services/service-registry'
import { ShellRegistryPort } from '../shells/shell-registry'
import { atlasDirectory } from '../store/paths'
import { SessionAuthorityPort } from '../store/sessions/meta'
import { ThreadStorePort } from '../store/thread-store'
import { LocalCompaction } from '../store/local-compaction'
import { LocalRotation, RotationPort, carryOverSummariser } from '../rotation'
import { LateRotation } from './rotation-binding'
import { ToolRegistry } from '../tools/registry'

import { bindBrowser } from './compose-browser'
import { bindSessionAgentTypes } from './compose-agent-types'
import { bindCredentials } from './compose-credentials'
import {
  bindProcessServices,
  claimLaunchWorkspace,
  closeSession,
  hookMishapNotice,
} from './compose-lifecycle'
import { bindMcp } from './compose-mcp'
import { bindQuality } from './compose-quality'
import { asPluginSurfaces, unplacedSessionOwner } from './compose-session'
import { PlacementController } from './placement-controller'
import { bindUtilityModels } from './compose-utility-models'
import type { HarnessLaunch } from './config'
import { publishProjections, type ContributedProjection } from '../plugins/projection'

import { bindInstructionsAndMemory } from './context-bindings'
import { boundCaptureContext } from './context-archive-binding'
import { faultInjected } from './fault-injection'
import type { HarnessApp, HarnessCloseRequest, HarnessStoreBinding, HarnessSurfaceBinding } from './harness-app'
import { bindModels } from './model-bindings'
import { loadSessionPlugins } from './plugin-loading'
import type { ActiveConversation } from './resume-hint'
import { journalResume } from './resume-journal'
import type { SettingsBinding } from './settings-binding'
import { bindSkillRegistry, liveSkillRegistry } from './skills-binding'
import { bindUserLayerSync } from './user-layer-sync-binding'
import { wireTurn } from './turn-wiring'
import { threadOpenedHandler } from './worktree-claims'

const SERVE_COMMAND = 'serve'

/**
 * A launch with no surface (serve) boots with a restored transcript and nobody to publish it, so
 * plugin projections fold the thread's log once here — the subscriptions and tracked state the log
 * implies cannot wait for the first turn. A launch with a surface leaves this alone: its surface
 * republishes the same events live. A log that cannot be read is a half-restored session, not a
 * boot failure, so the read's rejection is swallowed the same way the transcript's later folds
 * tolerate a missing row.
 */
async function seedProjectionsFromRestoredLog(args: {
  launch: HarnessLaunch
  log: EventLogPort
  projections: readonly ContributedProjection[]
}): Promise<void> {
  const threadId = args.launch.threadId
  if (threadId === undefined || args.projections.length === 0) return

  const events = await args.log.read({ threadId }).catch(() => null)
  if (events === null) return

  publishProjections({ projections: args.projections, events })
}

export async function composeHarness<TSurface = undefined, Command = never, TPluginSurface = unknown>(args: {
  launch: HarnessLaunch
  env: Record<string, string | undefined>
  settings: SettingsBinding
  clientVersion: string
  surface: HarnessSurfaceBinding<TSurface>
  ports: ComposedPortBindings
  stores?: HarnessStoreBinding | undefined
  bindPorts?: ((args: { container: DependencyContainer }) => void) | undefined
  repoIdentity?: string | null | undefined
  userSkillHome?: string | undefined
  /** Serve passes the drive home so user-layer sync resolves `.agents`/`.claude` under it. */
  userLayerHome?: string | undefined
}): Promise<HarnessApp<TSurface, Command, TPluginSurface>> {
  const { launch, surface } = args
  const notice = surface.notice
  const container = createHarnessContainer()
  container.register(ClientVersionToken, { useValue: args.clientVersion })
  container.register(registeredPortToken(NoticePort), { useValue: notice })
  args.bindPorts?.({ container })

  const { anchor, workspace } = await claimLaunchWorkspace({ container, launch })
  const mcp = await bindMcp({ container, cwd: anchor, notice })

  const settings = args.settings.service
  const settled = settings.snapshot().resolution
  let activeThread: ActiveConversation | null = null

  const launchValue = (id: ESettingId): string | undefined => {
    const held = textValueOf({ resolution: settled, id })
    return held.length === 0 ? undefined : held
  }

  bindProcessServices({ container, workspace })

  const { credentials, accounts, cloud, usage, secrets, accountList } = await bindCredentials({
    container,
    settings: args.settings,
    env: args.env,
    clientVersion: args.clientVersion,
    reconcileHostSources: launch.command !== SERVE_COMMAND,
    workspace,
    anchor,
    launchValue,
    notice,
  })

  await bindInstructionsAndMemory({
    container,
    settings,
    repoRoot: workspace.repo ?? workspace.workspace,
    repoIdentity: args.repoIdentity,
  })

  const userLayerSync = await bindUserLayerSync({
    container,
    clientVersion: args.clientVersion,
    projectDirectory: workspace.repo ?? workspace.workspace,
    home: args.userLayerHome,
  })

  const warnBoot = (error: unknown): void => {
    container.resolve(registeredPortToken(LogPort)).warn({
      source: 'user-layer-sync',
      message: `user-layer sync did not start: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  if (launch.command === SERVE_COMMAND) await userLayerSync.boot().catch(warnBoot)

  const {
    models,
    model,
    modelPinned,
  } = await bindModels({
    container,
    launch,
    settled,
    settings,
    credentials,
    accountList,
    notice,
    env: args.env,
  })

  const roots = { atlasHome: atlasDirectory(), home: homedir(), cwd: anchor }
  const skillRegistry = bindSkillRegistry({
    container,
    registry: await liveSkillRegistry({ ...roots, home: args.userSkillHome ?? roots.home, notice }),
  })
  const agentTypes = await bindSessionAgentTypes({ container, settings, launchValue, models, roots })

  const utility = bindUtilityModels({ container, settings, secrets, models, model, notice })
  if (args.stores !== undefined) await args.stores.bind({ container })

  const plugins = await loadSessionPlugins({ container, cwd: anchor, atlasHome: atlasDirectory(), notice })

  bindQuality({ container, settings })
  bindCloudSettingsWriteThrough({
    settings,
    store: () => container.resolve(CloudSettingsStoreToken),
    log: container.resolve(registeredPortToken(LogPort)),
  })
  const log = container.resolve(registeredPortToken(EventLogPort))
  await seedProjectionsFromRestoredLog({ launch, log, projections: plugins.projections })
  const ids = container.resolve(registeredPortToken(IdPort))
  const threads = container.resolve(registeredPortToken(ThreadStorePort))
  const placement = new PlacementController()
  placement.bind({
    threads,
    workspace: workspace.workspace,
    repo: workspace.repo,
    authority: container.isRegistered(registeredPortToken(SessionAuthorityPort), true)
      ? container.resolve(registeredPortToken(SessionAuthorityPort))
      : undefined,
  })
  const ledger = container.resolve(registeredPortToken(TurnLedgerPort))

  const lateRotation = new LateRotation()
  container.register(registeredPortToken(RotationPort), { useValue: lateRotation })

  container.register(HookMishapReporterToken, { useValue: hookMishapNotice(notice) })
  const bound = surface.bind === undefined ? undefined : await surface.bind({ container })

  const modelPort = faultInjected(container.resolve(registeredPortToken(ModelPort)))
  const prompts = container.resolve(registeredPortToken(PromptRegistry))
  const shells = container.resolve(registeredPortToken(ShellRegistryPort))
  const agents = container.resolve(registeredPortToken(AgentRegistryPort))
  const services = container.resolve(registeredPortToken(ServiceRegistryPort))
  const operatorInput = container.resolve(registeredPortToken(OperatorInputPort))

  const channel = createDeltaChannel({
    onListenerError: (cause) => container.resolve(registeredPortToken(LogPort)).error({
      source: 'channel.listener',
      message: cause instanceof Error ? cause.message : 'channel listener failed',
    }),
  })
  const pending = createPendingQueues<Command>()

  const { runner, turnPolicy, titling, recordTeardownEndings, intake } = wireTurn<Command>({
    container,
    workspace,
    models,
    model,
    modelPort,
    prompts,
    declarations: () => container.resolve(registeredPortToken(ToolRegistry)).declarations(),
    pending,
    pluginSources: plugins.intakeSources,
    channel,
    notice,
    summarise: utility.summarise,
    settings,
    decisionsEnabled: utility.decisionsEnabled,
    settled,
    sleepPrevention: container.resolve(SleepPreventionToken),
    wake: container.resolve(WakeSignalToken),
    tldr: { feed: surface.tldrFeed, model: utility.tldrModel, modelId: () => utility.tldrModel.modelId },
    titler: utility.titler,
  })

  const compaction = new LocalCompaction({ log, threads, agents, summarise: utility.summarise })
  const rotation = new LocalRotation({
    log,
    threads,
    agents,
    ids,
    summarise: carryOverSummariser({ model: utility.compactionModel }),
  })
  lateRotation.bind(rotation)
  const browser = bindBrowser({ anchor, settings })
  const sessionOwner = unplacedSessionOwner({ placement, threads, intake })

  let prepared: HarnessCloseRequest = {}

  return {
    launch,
    workspace,
    tools: container.resolve(registeredPortToken(ToolRegistry)),
    markActiveThread: (active) => {
      activeThread = active
      void userLayerSync.boot().catch(warnBoot)
    },
    activeThread: () => activeThread,
    titler: utility.titler,
    summarise: utility.summarise,
    compaction,
    rotation,
    settings,
    secrets,
    skills: skillRegistry.all(),
    skillRegistry,
    agentTypes,
    ...browser,
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
    intake,
    shells,
    agents,
    services,
    operatorInput,
    mcp: mcp.servers,
    mcpSignIn: mcp.signIn,
    threadOpened: threadOpenedHandler({ container, log, threads, ids, notice }),
    journalResume: ({ active, directory }) =>
      journalResume({ active, command: launch.command, directory }),
    captureContext: boundCaptureContext({ notice }),
    pluginProjections: plugins.projections,
    pluginSurfaces: asPluginSurfaces<TPluginSurface>(plugins.surfaces),
    model,
    modelPinned,
    models,
    sessionOwner,
    surface: bound as TSurface,
    prepareClose: (request) => {
      prepared = { ...prepared, ...request }
    },
    close: (request) =>
      closeSession({
        container,
        notice,
        usage,
        recordTeardownEndings,
        request: { ...prepared, ...request },
        stopShells: async () => {
          intake.suspend()
          await shells.closeAll(activeThread === null ? undefined : { threadId: toThreadId(activeThread.threadId) })
        },
      }),
    runner,
    turnPolicy,
    titling,
  }
}
