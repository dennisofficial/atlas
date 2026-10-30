import {
  defaultPipeline,
  ENoticeTone,
  EPromptAgent,
  ESettingId,
  promptContextFor,
  promptModelOf,
  contextWindowOf,
  toggleValueOf,
  ClockPort,
  DecisionPort,
  EventLogPort,
  IdPort,
  LogPort,
  QualityReviewPort,
  TelemetryPort,
  rangeValueOf,
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
import { registeredPortToken } from '../container/injection'
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
import type { ClockJumpDetector } from '../loop/retrying-step'
import type { WakeSignal } from '../wake/wake-signals'
import { ServiceRegistryPort } from '../services/service-registry'
import { ShellRegistryPort } from '../shells/shell-registry'
import { createLoopCut } from '../store/sessions/ops/cut-loop'
import { ThreadStorePort } from '../store/thread-store'
import { SaidUploadsPort } from '../uploads/said-uploads.port'
import { ToolDispatcher } from '../tools/dispatch'

import { compactTurn, ECompaction } from './compact-turn'
import { createTurnPolicyRunner } from './turn-policy-runner'
import type { TurnPolicy } from '../loop/turn-policy'
import { LocalRewindMachinery } from '../store/local-rewind-machinery'
import { createUsageTracker } from './usage-tracker'
import { turnBackgroundState } from './turn-background-state'
import { loopNotices } from './loop-notices'

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

  const log = container.resolve(registeredPortToken(EventLogPort))
  const logPort = container.resolve(registeredPortToken(LogPort))
  const ids = container.resolve(registeredPortToken(IdPort))
  const threads = container.resolve(registeredPortToken(ThreadStorePort))
  const ledger = container.resolve(registeredPortToken(TurnLedgerPort))
  const shells = container.resolve(registeredPortToken(ShellRegistryPort))
  const agents = container.resolve(registeredPortToken(AgentRegistryPort))
  const services = container.resolve(registeredPortToken(ServiceRegistryPort))

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
    pending,
    shells,
    agents,
    services,
    log,
    ids,
    stopSandbox: args.stopSandbox,
    logPort,
    pluginSources: args.pluginSources,
  })

  const { runningShells, runningAgents, runningServices } = turnBackgroundState({
    agents,
    shells,
    services,
  })
  const compiledPrompt = ({ projectDirectory }: { projectDirectory: string }) =>
    prompts.compile(
      promptContextFor({
        agent: EPromptAgent.Main,
        provider: modelPort.identity,
        model: promptModelOf(models.cardFor(model.choice().ref)),
        projectDirectory,
        placement: executionLocation.current(),
        runner: executionLocation.currentRunner(),
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
    dispatch: container.resolve(registeredPortToken(ToolDispatcher)),
    hooks: container.resolve(HookChainToken),
    uploads: container.resolve(registeredPortToken(SaidUploadsPort)),
    drainPending: (args) => intake.prepare(args),
    expandContext: args.pending.expandContext,
    spend: {
      ledger,
      clock: container.resolve(registeredPortToken(ClockPort)),
      telemetry: container.resolve(registeredPortToken(TelemetryPort)),
    },
    compact: compactBeforeOverflow,
    applyLoopCut: createLoopCut({
      log,
      registry: container.resolve(SessionRegistryToken),
      clock: container.resolve(registeredPortToken(ClockPort)),
      ids,
    }),
    watchLoop: jevLoopWatch({
      decisions: container.resolve(registeredPortToken(DecisionPort)),
      enabled: args.decisionsEnabled,
    }),
    ...loopNotices({ notice }),
  }

  const childModels = {
    models,
    model,
    threads,
    hooks: () => container.resolve(HookChainToken),
    settings: args.settings,
    notice,
    ...(args.wake === undefined ? {} : { wake: args.wake }),
  }
  const modelFor = childModelSource(childModels)
  const modelAtSpawn = childModelSelection(childModels)
  container.register(ChildRunnerDepsToken, {
    useValue: (): ChildRunnerDeps => ({
      turn,
      tools: container.resolve(registeredPortToken(ToolRegistry)),
      hooks: container.resolve(HookChainToken),
      quality: container.isRegistered(registeredPortToken(QualityReviewPort), true)
        ? container.resolve(registeredPortToken(QualityReviewPort))
        : undefined,
      channel: args.channel,
      drainNotices: (request) => intake.prepare(request),
      intake,
      modelFor,
      modelAtSpawn,
      telemetry: container.resolve(registeredPortToken(TelemetryPort)),
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
              model: {
                contextWindow:
                  contextWindowOf(childModel) || promptModelOf(undefined).contextWindow,
              },
              projectDirectory,
              placement: executionLocation.current(),
              runner: executionLocation.currentRunner(),
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
    if (
      feed === undefined ||
      !toggleValueOf({ resolution: args.settled, id: ESettingId.TldrFooter })
    ) {
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
