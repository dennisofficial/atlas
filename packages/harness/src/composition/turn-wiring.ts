import {
  defaultPipeline,
  EAgentStatus,
  ENoticeTone,
  EPromptAgent,
  EServiceStatus,
  ESettingId,
  EShellStatus,
  isTurnTaking,
  NOTICE_WARN_MS,
  promptContextFor,
  promptModelOf,
  contextWindowOf,
  toggleValueOf,
  ClockPort,
  DecisionPort,
  EventLogPort,
  IdPort,
  LogPort,
  ModelPort,
  TelemetryPort,
  rangeValueOf,
  type EventDraft,
  type NoticePort,
  type SaidImage,
  type SettingsResolution,
  type ThreadId,
} from '@dltech/atlas-core'

import { withDeltaPublishing } from '../channel/publishing-event-log'
import { PublishingTurnRunner } from '../channel/publishing-turn-runner'
import { AgentRegistryPort } from '../agents/registry/port'
import { childModelSelection, childModelSource } from './child-model'
import { subAgentPrompt } from '../agents/registry/child-prompt'
import type { ChildRunnerDeps } from '../agents/registry/child-runner'
import { isTeammateType } from '../agents/types'
import { ChildRunnerDepsToken } from '../container/create-harness-container'
import { portToken, type DependencyContainer } from '../container/injection'
import { ToolRegistry } from '../tools/registry'
import { DeltaChannelToken, HookChainToken, SessionRegistryToken } from '../container/tokens'
import { TurnLedgerPort } from '../ledger/turn-ledger.port'
import { jevLoopWatch } from '../loop/loop-watchdog'
import type { TurnDeps } from '../loop/run-turn'

import type { MessageIntake } from '../intake'
import { bindIntake } from './intake-binding'

import type { TurnSetup } from './turn-setup'
import { TitlingTurnRunner } from './titling-turn-runner'
import { TldrTurnRunner } from '../loop/tldr-turn-runner'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { PendingQueues } from '../pending'
import { userSaidDraft } from '../pending'
import type { PromptRegistry } from '../prompt/registry'
import type { SleepPrevention } from '../power/sleep-prevention'
import type { ClockJumpDetector } from '../loop/retrying-step'
import type { WakeSignal } from '../wake/wake-signals'
import { ServiceRegistryPort } from '../services/service-registry'
import { ShellRegistryPort } from '../shells/shell-registry'
import { createLoopCut } from '../store/sessions/ops/cut-loop'
import { ThreadStorePort } from '../store/thread-store'
import { ToolDispatcher } from '../tools/dispatch'

import { compactTurn, ECompaction } from './compact-turn'
import { createTurnPolicyRunner } from './turn-policy-runner'
import type { TurnPolicy } from '../loop/turn-policy'
import { LocalRewindMachinery } from '../store/local-rewind-machinery'
import { createUsageTracker } from './usage-tracker'

const asClockJumps = (wake: WakeSignal): ClockJumpDetector => ({
  onJump: (callback) => wake.subscribe((jump) => callback(jump.gapMs)),
})

export type TurnWiring = {
  turn: TurnDeps
  runner: TurnRunner
  turnPolicy: TurnPolicy
  titling: TitlingTurnRunner
  recordTeardownEndings: () => Promise<void>
  intake: MessageIntake
}

export const noticesWakeTurn = (args: {
  agentWakes: boolean
  shellDrafts: readonly EventDraft[]
  serviceDrafts: readonly EventDraft[]
}): boolean =>
  args.agentWakes ||
  args.shellDrafts.some((draft) => isTurnTaking(draft)) ||
  args.serviceDrafts.some((draft) => isTurnTaking(draft))

export function wireTurn<Command>(args: TurnSetup<Command>): TurnWiring {
  const {
    container,
    workspace,
    executionLocation,
    models,
    model,
    modelPort,
    prompts,
    pending,
    notice,
  } = args

  container.register(DeltaChannelToken, { useValue: args.channel })

  const log = container.resolve(portToken(EventLogPort))
  const logPort = container.resolve(portToken(LogPort))
  const ids = container.resolve(portToken(IdPort))
  const threads = container.resolve(portToken(ThreadStorePort))
  const ledger = container.resolve(portToken(TurnLedgerPort))
  const shells = container.resolve(portToken(ShellRegistryPort))
  const agents = container.resolve(portToken(AgentRegistryPort))
  const services = container.resolve(portToken(ServiceRegistryPort))

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

  const { intake, recordTeardownEndings } = bindIntake({
    pending, shells, agents, services, log, ids, stopSandbox: args.stopSandbox,
  })

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
    ...(args.sleepPrevention === undefined ? {} : { sleepPrevention: args.sleepPrevention }),
    ...(args.wake === undefined ? {} : { retry: { clockJumps: asClockJumps(args.wake) } }),
    assembly: defaultPipeline({
      prompt: compiledPrompt,
      launchDirectory: workspace.workspace,
      repoRoot: workspace.repo ?? undefined,
      runningShells,
      runningAgents,
      runningServices,
    }),
    launchDirectory: workspace.workspace,
    tools: args.declarations,
    dispatch: container.resolve(portToken(ToolDispatcher)),
    hooks: container.resolve(HookChainToken),
    drainPending: (args) => intake.prepare(args),
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

  const childModels = {
    models,
    model,
    threads,
    hooks: () => container.resolve(HookChainToken),
    settings: args.settings,
    ...(args.wake === undefined ? {} : { wake: args.wake }),
  }
  const modelFor = childModelSource(childModels)
  const modelAtSpawn = childModelSelection(childModels)

  container.register(ChildRunnerDepsToken, {
    useValue: (): ChildRunnerDeps => ({
      turn,
      tools: container.resolve(portToken(ToolRegistry)),
      hooks: container.resolve(HookChainToken),
      channel: args.channel,
      drainNotices: (request) => intake.prepare(request),
      intake,
      modelFor,
      modelAtSpawn,
      telemetry: container.resolve(portToken(TelemetryPort)),
      hydratePlacement: async ({ threadId }) => {
        await executionLocation.load({ threadId })
      },
      assemblyFor: ({ agentType, model: childModel, projectDirectory: working }) =>
        defaultPipeline({
          prompt: ({ projectDirectory }) =>
            subAgentPrompt({
              prompts,
              agentType,
              agent: isTeammateType(agentType.name) ? EPromptAgent.Main : EPromptAgent.Sub,
              provider: childModel.identity,
              model: { contextWindow: contextWindowOf(childModel) || promptModelOf(undefined).contextWindow },
              projectDirectory,
            }),
          launchDirectory: working ?? workspace.workspace,
          repoRoot: workspace.repo ?? undefined,
          runningShells,
          runningServices,
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
    ids,
    readClock: () => Date.now(),
  })

  return { turn, runner: turnPolicy, turnPolicy, titling, recordTeardownEndings, intake }
}
