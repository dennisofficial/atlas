import { afterEach, describe, expect, it } from 'bun:test'
import type { LanguageModel } from 'ai'

import {
  ATLAS_SETTINGS,
  DecisionPort,
  EEffort,
  ESettingId,
  ETldrStatus,
  EWebSearchBackend,
  EventLogPort,
  ModelPort,
  QualityReviewPort,
  toRunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import { createDecisionClient } from '../../classifier/decision-backend'
import {
  ChildRunnerDepsToken,
  createHarnessContainer,
} from '../../container/create-harness-container'
import { registeredPortToken, type DependencyContainer } from '../../container/injection'
import {
  DeltaChannelToken,
  HookChainToken,
  LanguageModelToken,
  SecretsStoreToken,
  WebSearchBackendToken,
  WorktreeDirectoryToken,
  WorkspaceRoot,
} from '../../container/tokens'
import { TurnLedgerPort, type TurnSpend } from '../../ledger/turn-ledger.port'
import { createTempHome, type TempHome } from '../../loop/__tests__/temp-home'
import { ETurnStatus } from '../../loop/turn-outcome'
import type { TldrFeed } from '../../loop/tldr-turn-runner'
import { scriptedModel } from '../../model/testing/scripted-model'
import { createPendingQueues } from '../../pending'
import { PromptRegistry } from '../../prompt/registry'
import {
  FileSettingsStore,
  V1_ONLY_SETTING_DEFINITIONS,
  createSettingsService,
  userSettingsFile,
} from '../../settings'
import { ThreadStorePort } from '../../store/thread-store'
import { ToolRegistry } from '../../tools/registry'
import { DEFAULT_MODEL_REF } from '../config'
import { ExecutionLocationToken } from '../execution-location-state'
import { selectableModel } from '../model-selection'
import type { TurnSetup } from '../turn-setup'
import { wireTurn } from '../turn-wiring'
import { fakeCatalogue, recordingNotices } from './fakes'

const ROOT = '/workspace/atlas'

const spendFields: Omit<TurnSpend, 'runId' | 'threadId'> = {
  status: 'done',
  providerId: 'anthropic',
  modelId: 'claude-opus',
  steps: 1,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  startedAt: '2026-11-18T00:00:00.000Z',
  endedAt: '2026-11-18T00:00:01.000Z',
  durationMs: 1_000,
}

const opened: { temp: TempHome; previousHome: string | undefined }[] = []

afterEach(() => {
  for (const entry of opened.splice(0)) {
    if (entry.previousHome === undefined) delete process.env['ATLAS_HOME']
    else process.env['ATLAS_HOME'] = entry.previousHome
    entry.temp.discard()
  }
})

type Rig = ReturnType<typeof rig>

function rig(
  args: {
    review?: QualityReviewPort | undefined
    footers?: boolean
    feed?: TldrFeed | undefined
  } = {},
) {
  const temp = createTempHome()
  const previousHome = process.env['ATLAS_HOME']
  process.env['ATLAS_HOME'] = temp.home
  opened.push({ temp, previousHome })

  const container = createHarnessContainer()
  container.register(WorkspaceRoot, { useValue: ROOT })
  container.register(WorktreeDirectoryToken, { useValue: () => '.atlas/worktrees' })
  container.register(WebSearchBackendToken, { useValue: () => EWebSearchBackend.DuckDuckGo })
  container.register(LanguageModelToken, {
    useValue: scriptedModel({ script: [{ text: 'the turn answered' }] }),
  })

  const settings = createSettingsService({
    definitions: [...ATLAS_SETTINGS, ...V1_ONLY_SETTING_DEFINITIONS],
    user: new FileSettingsStore({ file: userSettingsFile(), label: 'turn-wiring spec' }),
  })
  if (args.footers === false) settings.set({ id: ESettingId.TldrFooter, value: false })

  container.register(registeredPortToken(DecisionPort), {
    useValue: createDecisionClient({
      settings,
      secrets: container.resolve(SecretsStoreToken),
    }),
  })
  if (args.review !== undefined) {
    container.register(registeredPortToken(QualityReviewPort), { useValue: args.review })
  }

  const catalogue = fakeCatalogue()
  const channel = createDeltaChannel()
  const pending = createPendingQueues<never>()
  let tldrCalls = 0
  const tldrModel = scriptedModel({
    script: [{ text: JSON.stringify({ status: ETldrStatus.Done, summary: 'wired the turn' }) }],
  })
  const streamed = tldrModel.doStream
  tldrModel.doStream = async (options) => {
    tldrCalls += 1
    return streamed.call(tldrModel, options)
  }

  const setup: TurnSetup<never> = {
    container,
    workspace: { workspace: ROOT, repo: null },
    executionLocation: container.resolve(ExecutionLocationToken).state,
    models: catalogue,
    model: selectableModel({
      catalogue,
      initial: { ref: DEFAULT_MODEL_REF, effort: EEffort.Medium },
    }),
    modelPort: container.resolve(registeredPortToken(ModelPort)),
    prompts: container.resolve(registeredPortToken(PromptRegistry)),
    declarations: () => container.resolve(registeredPortToken(ToolRegistry)).declarations(),
    pending,
    channel,
    notice: recordingNotices().port,
    summarise: async () => null,
    settings,
    decisionsEnabled: () => false,
    stopSandbox: async () => false,
    settled: settings.snapshot().resolution,
    tldr: {
      feed: args.feed,
      model: tldrModel as LanguageModel,
      modelId: () => 'tldr-spec',
    },
    titler: async () => null,
  }

  return {
    container,
    channel,
    pending,
    log: container.resolve(registeredPortToken(EventLogPort)),
    threads: container.resolve(registeredPortToken(ThreadStorePort)),
    tldrCalls: () => tldrCalls,
    wire: () => wireTurn<never>(setup),
  }
}

const childDeps = (container: DependencyContainer) => container.resolve(ChildRunnerDepsToken)()

type FooterLog = { log: EventLogPort; threadId: ThreadId }

const wroteFooter = async (args: FooterLog): Promise<boolean> =>
  (await args.log.read({ threadId: args.threadId })).some((event) => event.type === 'tldr-written')

const footerWithin = async (args: FooterLog & { withinMs: number }): Promise<boolean> => {
  const deadline = Date.now() + args.withinMs
  while (Date.now() < deadline) {
    if (await wroteFooter(args)) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

const runSaidTurn = async (
  held: Rig,
): Promise<{
  outcome: ETurnStatus
  threadId: ThreadId
}> => {
  const threadId = (await held.threads.create({})).id
  const wiring = held.wire()
  held.pending.forThread({ threadId }).enqueue({ text: 'say something' })
  const outcome = await wiring.runner.runTurn({ threadId })
  return { outcome: outcome.status, threadId }
}

describe('the child runner deps wireTurn registers', () => {
  it('hands a child the very turn, intake, activity and channel the wiring returns', () => {
    const held = rig()
    const wiring = held.wire()
    const deps = childDeps(held.container)

    expect(deps.turn).toBe(wiring.turn)
    expect(deps.intake).toBe(wiring.intake)
    expect(deps.activity).toBe(wiring.activity)
    expect(deps.channel).toBe(held.channel)
  })

  it('carries no quality port while the container registers none', () => {
    const held = rig()

    held.wire()

    expect(childDeps(held.container).quality).toBeUndefined()
  })

  it('carries the quality port the container resolved once one is registered', () => {
    const port: QualityReviewPort = { captureEnabled: () => false, review: async () => [] }
    const held = rig({ review: port })

    held.wire()

    expect(childDeps(held.container).quality).toBe(port)
  })

  it('records spending through the ledger the container serves', async () => {
    const held = rig()
    const threadId = (await held.threads.create({})).id
    const wiring = held.wire()
    const spend = wiring.turn.spend
    const wiredLedger = spend?.ledger
    if (wiredLedger === undefined) throw new Error('a wired turn records its spend')

    await wiredLedger.record({ ...spendFields, runId: toRunId('run_wired'), threadId })

    const ledger = held.container.resolve(registeredPortToken(TurnLedgerPort))
    expect((await ledger.forThread({ threadId })).map((entry) => entry.runId)).toEqual([
      toRunId('run_wired'),
    ])
  })

  it('shares the hook chain the container holds', () => {
    const held = rig()

    const wiring = held.wire()

    expect(wiring.turn.hooks).toBe(held.container.resolve(HookChainToken))
  })
})

describe('the tl;dr footer a wired turn writes', () => {
  const feed = (): { feed: TldrFeed; written: Promise<void> } => {
    let finish: () => void = () => undefined
    const written = new Promise<void>((resolve) => {
      finish = resolve
    })
    return { feed: { started: () => {}, chunk: () => {}, finished: () => finish() }, written }
  }

  it('writes a footer when a feed is present and the setting is on', async () => {
    const tldr = feed()
    const held = rig({ feed: tldr.feed })

    const { outcome, threadId } = await runSaidTurn(held)

    expect(outcome).toBe(ETurnStatus.Completed)
    await tldr.written
    expect(await wroteFooter({ log: held.log, threadId })).toBe(true)
    expect(held.tldrCalls()).toBe(1)
  }, 30_000)

  it('never asks the tl;dr model without a feed, even with the setting on', async () => {
    const held = rig()

    const { outcome, threadId } = await runSaidTurn(held)

    expect(outcome).toBe(ETurnStatus.Completed)
    expect(await footerWithin({ log: held.log, threadId, withinMs: 400 })).toBe(false)
    expect(held.tldrCalls()).toBe(0)
  }, 30_000)

  it('never asks the tl;dr model with the footer setting off, even with a feed', async () => {
    const held = rig({ feed: feed().feed, footers: false })

    const { outcome, threadId } = await runSaidTurn(held)

    expect(outcome).toBe(ETurnStatus.Completed)
    expect(await footerWithin({ log: held.log, threadId, withinMs: 400 })).toBe(false)
    expect(held.tldrCalls()).toBe(0)
  }, 30_000)
})

describe('the wiring a session composes', () => {
  it('binds a delta channel the container serves from then on', () => {
    const held = rig()

    held.wire()

    expect(held.container.resolve(DeltaChannelToken)).toBe(held.channel)
  })
})
