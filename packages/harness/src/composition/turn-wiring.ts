import {
  agentTypeSettingId,
  defaultPipeline,
  EAgentStatus,
  ENoticeTone,
  EPromptAgent,
  EServiceStatus,
  ESettingId,
  EShellStatus,
  isTurnTaking,
  NOTICE_WARN_MS,
  parseRef,
  promptContextFor,
  promptModelOf,
  textValueOf,
  toggleValueOf,
  ClockPort,
  DecisionPort,
  EventLogPort,
  IdPort,
  LogPort,
  ModelPort,
  TelemetryPort,
  rangeValueOf,
  type CapabilitiesSource,
  type EventDraft,
  type ModelCard,
  type NoticePort,
  type SaidImage,
  type SettingsResolution,
  type ThreadId,
  type ToolDeclaration,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { LanguageModel } from 'ai'

import type { DeltaChannel } from '../channel/delta-channel'
import { withDeltaPublishing } from '../channel/publishing-event-log'
import { PublishingTurnRunner } from '../channel/publishing-turn-runner'
import type { ChildRunnerDeps } from '../agents/registry/child-runner'
import { subAgentPrompt } from '../agents/registry/child-prompt'
import { isTeammateType } from '../agents/types'
import { AgentRegistryPort } from '../agents/registry/port'
import { childModelSource } from './model-bindings'
import { ChildRunnerDepsToken } from '../container/create-harness-container'
import { portToken, type DependencyContainer } from '../container/injection'
import { DeltaChannelToken, HookChainToken, SessionRegistryToken } from '../container/tokens'
import { TurnLedgerPort } from '../ledger/turn-ledger.port'
import { jevLoopWatch } from '../loop/loop-watchdog'
import type { PendingDrain, TurnDeps } from '../loop/run-turn'

import { ChildWake } from './child-wake'
import { TitlingTurnRunner } from './titling-turn-runner'
import { TldrTurnRunner, type TldrFeed } from '../loop/tldr-turn-runner'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { PendingQueues } from '../pending'
import { userSaidDraft } from '../pending'
import type { PromptRegistry } from '../prompt/registry'
import { ServiceRegistryPort } from '../services/service-registry'
import type { SettingsService } from '../settings/service'
import { ShellRegistryPort } from '../shells/shell-registry'
import { createLoopCut } from '../store/sessions/ops/cut-loop'
import { ThreadStorePort } from '../store/thread-store'
import { ToolDispatcher } from '../tools/dispatch'
import { ToolRegistry } from '../tools/registry'

import { compactTurn, ECompaction, type Summariser } from './compact-turn'
import type { ExecutionLocationState } from './execution-location-state'
import { createTurnPolicyRunner } from './turn-policy-runner'
import type { TurnPolicy } from '../loop/turn-policy'
import { LocalRewindMachinery } from '../store/local-rewind-machinery'
import { createUsageTracker } from './usage-tracker'
import { faultInjected } from './fault-injection'
import type { ModelCatalogue } from './model-catalogue'
import type { SelectableModel } from './model-selection'
import { teardownSession, type TeardownSource } from './session-teardown'

export type TurnWiring = {
  turn: TurnDeps
  runner: TurnRunner
  turnPolicy: TurnPolicy
  titling: TitlingTurnRunner
  drainNotices: (args: { threadId: ThreadId }) => Promise<PendingDrain>
  recordTeardownEndings: () => Promise<void>
}

// A shell or service ending is speech the model must answer, so it wakes the turn the way an agent
// ending does. A draft is an Event missing only its envelope fields, which isTurnTaking never reads.
export const noticesWakeTurn = (args: {
  agentWakes: boolean
  shellDrafts: readonly EventDraft[]
  serviceDrafts: readonly EventDraft[]
}): boolean =>
  args.agentWakes ||
  args.shellDrafts.some((draft) => isTurnTaking(draft as Parameters<typeof isTurnTaking>[0])) ||
  args.serviceDrafts.some((draft) => isTurnTaking(draft as Parameters<typeof isTurnTaking>[0]))

export function wireTurn<Command>(args: {
  container: DependencyContainer
  workspace: WorkspaceIdentity
  executionLocation: ExecutionLocationState
  capabilities?: CapabilitiesSource | undefined
  mounts: readonly string[]
  models: ModelCatalogue
  model: SelectableModel
  modelPort: ModelPort
  prompts: PromptRegistry
  declarations: () => readonly ToolDeclaration[]
  pending: PendingQueues<Command>
  channel: DeltaChannel
  notice: NoticePort
  summarise: Summariser
  settings: SettingsService
  decisionsEnabled: () => boolean
  stopSandbox: () => Promise<boolean>
  settled: SettingsResolution
  tldr: { feed: TldrFeed | undefined; model: LanguageModel; modelId: () => string }
  titler: (args: {
    text: string
    images?: readonly SaidImage[] | undefined
  }) => Promise<string | null>
}): TurnWiring {
  const {
    container,
    workspace,
    executionLocation,
    mounts,
    models,
    model,
    modelPort,
    prompts,
    pending,
    notice,
  } = args

  // The channel is created per-compose, after the container, so it cannot be a container-native
  // registration; the tool factories that consume it resolve lazily, after this runs.
  container.register(DeltaChannelToken, { useValue: args.channel })

  const log = container.resolve(portToken(EventLogPort))
  const logPort = container.resolve(portToken(LogPort))
  const ids = container.resolve(portToken(IdPort))
  const threads = container.resolve(portToken(ThreadStorePort))
  const ledger = container.resolve(portToken(TurnLedgerPort))
  const shells = container.resolve(portToken(ShellRegistryPort))
  const agents = container.resolve(portToken(AgentRegistryPort))
  const services = container.resolve(portToken(ServiceRegistryPort))

  /**
   * The loop asks for this only when a step would otherwise be sent a prompt the window cannot hold,
   * which is the one moment compacting mid-turn is safe: the loop is between steps and re-reads the
   * log itself afterwards.
   */
  const compactBeforeOverflow = async ({ threadId }: { threadId: ThreadId }): Promise<boolean> => {
    const compaction = await compactTurn({
      log,
      threads,
      agents,
      threadId,
      summarise: args.summarise,
    })
    return compaction.type === ECompaction.Compacted
  }

  const recordTeardownEndings = async (): Promise<void> => {
    childWake.dispose()
    const agentEndings: TeardownSource = {
      closeAll: () => agents.closeAll(),
      threadsAwaitingNotice: () => agents.threadsAwaitingNotice(),
      drainNotifications: ({ threadId }) => agents.drainNotifications({ threadId }).drafts,
    }
    await teardownSession({
      sources: [shells, agentEndings, services],
      log,
      ids,
      stopSandbox: args.stopSandbox,
    })
  }

  const childWake = new ChildWake({ agents, sources: [shells, services, agents] })

  const runningShells = ({ threadId }: { threadId: ThreadId }) =>
    shells
      .list({ threadId })
      .filter((shell) => shell.status === EShellStatus.Running)
      .map((shell) => ({
        shellId: shell.shellId,
        command: shell.command,
        description: shell.description,
        awaitingInput: shell.awaitingInput,
        totalCharacters: shell.totalCharacters,
      }))

  const runningAgents = ({ threadId }: { threadId: ThreadId }) =>
    agents
      .list({ threadId })
      .filter((agent) => agent.status === EAgentStatus.Running)
      .map((agent) => ({
        agentId: agent.agentId,
        agentType: agent.agentType,
        intent: agent.intent,
      }))

  const runningServices = () =>
    services
      .list()
      .filter((service) => service.status === EServiceStatus.Running)
      .map((service) => ({
        serviceId: service.serviceId,
        command: service.command,
        description: service.description,
        logPath: service.logPath,
      }))

  const drainNotices = async ({
    threadId,
  }: {
    threadId: ThreadId
  }): Promise<PendingDrain> => {
    const agentDrain = agents.drainNotifications({ threadId })
    const shellDrafts = shells.drainNotifications({ threadId })
    const serviceDrafts = services.drainNotifications({ threadId })
    return {
      drafts: [...shellDrafts, ...agentDrain.drafts, ...serviceDrafts],
      wakesTurn: noticesWakeTurn({
        agentWakes: agentDrain.wakesTurn,
        shellDrafts,
        serviceDrafts,
      }),
    }
  }

  const compiledPrompt = ({ projectDirectory }: { projectDirectory: string }) =>
    prompts.compile(
      promptContextFor({
        agent: EPromptAgent.Main,
        provider: modelPort.identity,
        model: promptModelOf(models.cardFor(model.choice().ref)),
        projectDirectory,
      }),
    )

  const turn: TurnDeps = {
    log,
    logPort,
    model: modelPort,
    ids,
    assembly: defaultPipeline({
      prompt: compiledPrompt,
      launchDirectory: workspace.workspace,
      repoRoot: workspace.repo ?? undefined,
      runningShells,
      runningAgents,
      runningServices,
      executionLocation: ({ threadId }) => {
        void executionLocation.load({ threadId })
        return {
          location: executionLocation.of(threadId) ?? executionLocation.current(),
          mounts,
        }
      },
      capabilities: args.capabilities,
    }),
    launchDirectory: workspace.workspace,
    tools: args.declarations,
    dispatch: container.resolve(portToken(ToolDispatcher)),
    hooks: container.resolve(HookChainToken),
    drainPending: async (drained) => {
      const notices = await drainNotices(drained)
      const typed = pending.forThread({ threadId: drained.threadId }).drain().map(userSaidDraft)
      return {
        drafts: [...notices.drafts, ...typed],
        wakesTurn: notices.wakesTurn || typed.length > 0,
      }
    },
    spend: {
      ledger,
      clock: container.resolve(portToken(ClockPort)),
      telemetry: container.resolve(portToken(TelemetryPort)),
    },
    compact: compactBeforeOverflow,
    applyLoopCut: createLoopCut({
      log,
      registry: container.resolve(SessionRegistryToken),
      clock: container.resolve(portToken(ClockPort)),
      ids,
    }),
    watchLoop: jevLoopWatch({
      decisions: container.resolve(portToken(DecisionPort)),
      enabled: args.decisionsEnabled,
    }),
    onLoopWatch: () =>
      notice.notify({
        tone: ENoticeTone.Warn,
        text: 'the watchdog judged this turn to be looping and could not cut it — the agent was nudged to break the pattern, and the turn will stop if it keeps going',
        ttlMs: NOTICE_WARN_MS,
      }),
    onLoopWatchCut: ({ steps }) =>
      notice.notify({
        tone: ENoticeTone.Warn,
        text: `the watchdog cut ${steps} steps from this turn — the decision model judged them a loop and loops left in context invite more looping. If the pattern re-forms, the turn will be stopped`,
        ttlMs: NOTICE_WARN_MS,
      }),
    onLoopStop: () =>
      notice.notify({
        tone: ENoticeTone.Warn,
        text: 'the watchdog stopped this turn — it still looked stuck after a warning, so the turn ended instead of spinning. Send a message to pick it back up',
        ttlMs: NOTICE_WARN_MS,
      }),
    onLoopCut: (cut) =>
      notice.notify({
        tone: ENoticeTone.Warn,
        text: `cut a runaway loop: ${cut.names.join(', ')} returned identical results ${cut.repeats} times in a row, so the turn was rewound to before the repetition`,
        ttlMs: NOTICE_WARN_MS,
      }),
  }

  const modelFor = childModelSource({
    models,
    model,
    modelPort,
    hooks: () => container.resolve(HookChainToken),
    settings: args.settings,
  })

  const cardPinnedTo = (pinned: string | undefined): ModelCard | undefined => {
    if (pinned === undefined) return models.cardFor(model.choice().ref)

    const ref = parseRef(pinned)
    return ref === undefined ? undefined : models.cardFor(ref)
  }

  const subagentSetting = (id: string): string | undefined => {
    const held = textValueOf({ resolution: args.settings.snapshot().resolution, id })
    return held.length === 0 ? undefined : held
  }

  /**
   * The supervisor holds this as a thunk rather than a value: `agent_spawn` is a ToolDefinition the
   * ToolRegistry constructs, so resolving a child's tools while the supervisor is being built would
   * close the cycle. Nothing here is read until the first spawn.
   */
  container.register(ChildRunnerDepsToken, {
    useValue: (): ChildRunnerDeps => ({
      turn,
      tools: container.resolve(portToken(ToolRegistry)),
      hooks: container.resolve(HookChainToken),
      channel: args.channel,
      drainNotices,
      modelFor,
      telemetry: container.resolve(portToken(TelemetryPort)),
      assemblyFor: ({ agentType, projectDirectory: working }) =>
        defaultPipeline({
          prompt: ({ projectDirectory }) =>
            subAgentPrompt({
              prompts,
              agentType,
              agent: isTeammateType(agentType.name) ? EPromptAgent.Main : EPromptAgent.Sub,
              provider: modelPort.identity,
              model: promptModelOf(
                cardPinnedTo(
                  subagentSetting(agentTypeSettingId(agentType.name)) ??
                    agentType.model ??
                    subagentSetting(ESettingId.SubagentModel),
                ),
              ),
              projectDirectory,
            }),
          launchDirectory: working ?? workspace.workspace,
          repoRoot: workspace.repo ?? undefined,
          runningShells,
          runningServices,
          executionLocation: ({ threadId }) => {
            void executionLocation.load({ threadId })
            return {
              location: executionLocation.of(threadId) ?? executionLocation.current(),
              mounts,
            }
          },
          capabilities: args.capabilities,
        }),
    }),
  })

  const usage = createUsageTracker({ channel: args.channel, log })
  const atPercent = () =>
    rangeValueOf({
      resolution: args.settings.snapshot().resolution,
      id: ESettingId.AutoCompact,
      fallback: 90,
    })

  const runner = ((): TurnRunner => {
    const publishing = new PublishingTurnRunner({ channel: args.channel, deps: turn })
    const feed = args.tldr.feed
    if (feed === undefined || !toggleValueOf({ resolution: args.settled, id: ESettingId.TldrFooter })) {
      return publishing
    }

    return new TldrTurnRunner({
      inner: publishing,
      log: withDeltaPublishing({ log, channel: args.channel }),
      ids,
      model: args.tldr.model,
      modelId: args.tldr.modelId,
      feed,
      onMishap: () =>
        notice.notify({
          tone: ENoticeTone.Warn,
          text: 'Could not write the tl;dr footer for that turn.',
        }),
    })
  })()

  const titling = new TitlingTurnRunner({
    inner: runner,
    log,
    threads,
    titler: args.titler,
    notice,
  })
  const turnPolicy = createTurnPolicyRunner({
    inner: titling,
    log,
    threads,
    agents,
    machinery: new LocalRewindMachinery({ agents, shells, services }),
    model: modelPort,
    summarise: args.summarise,
    usage,
    atPercent,
    notice,
    readClock: () => Date.now(),
  })

  return { turn, runner: turnPolicy, turnPolicy, titling, drainNotices, recordTeardownEndings }
}
