import { describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  EStage,
  saidBody,
  toCallId,
  toRunId,
  type BeforeToolOutcome,
} from '@dltech/atlas-core'

import { rigOf, THREAD, transientFailure } from '../../__tests__/exit-fixture'
import { HookChain } from '../../hooks/registry'
import { FakeTool, InMemoryModelContext, InMemoryOnceLedger, fakeToolRegistry } from '../../testing'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { ETurnStatus } from '../turn-outcome'

const denyHook = (
  consulted: string[],
): {
  name: string
  order: { stage: EStage; nudge: number }
  run: () => Promise<BeforeToolOutcome>
} => ({
  name: 'deny-writes',
  order: { stage: EStage.Guard, nudge: 0 },
  run: async () => {
    consulted.push('consulted')
    return { decision: EBeforeToolDecision.Deny, reason: 'no writes' }
  },
})

describe('OnceLedger through LoopTurnRunner', () => {
  it('a recorded deny is not re-decided when a second runner resumes the same pending call', async () => {
    const consulted: string[] = []
    const ledger = new InMemoryOnceLedger()
    const tool = new FakeTool('bash', 'ok')

    const firstRig = rigOf({
      tools: [tool],
      script: [{ text: 'unused' }],
      overrides: {
        dispatch: new HookedToolDispatcher({
          registry: fakeToolRegistry([tool]),
          hooks: new HookChain({ beforeTool: [denyHook(consulted)] }),
        }),
        onceLedger: ledger,
      },
    })

    const seed = toRunId('run-seed')
    await firstRig.record.append({
      threadId: THREAD,
      runId: seed,
      drafts: [
        saidBody({ text: 'please run bash' }),
        { type: 'tool-called', callId: toCallId('call-1'), name: 'bash', input: {}, ordinal: 0 },
      ],
    })

    firstRig.record.failNextAppend(new Error('restart before the deny committed'))
    await firstRig.runner.resume({ threadId: THREAD }).catch(() => undefined)
    expect(consulted).toHaveLength(1)
    expect(ledger.has('hook:deny-writes:run-seed:call-1')).toBe(true)
    expect(
      firstRig.record.eventsOf(THREAD).filter((event) => event.type === 'tool-denied'),
    ).toHaveLength(0)

    const secondRig = rigOf({
      tools: [tool],
      script: [{ text: 'unused' }],
      overrides: {
        record: firstRig.record,
        modelContext: new InMemoryModelContext(firstRig.record),
        dispatch: new HookedToolDispatcher({
          registry: fakeToolRegistry([tool]),
          hooks: new HookChain({ beforeTool: [denyHook(consulted)] }),
        }),
        onceLedger: ledger,
      },
    })

    const second = await secondRig.runner.resume({ threadId: THREAD })
    expect(second.status).toBe(ETurnStatus.Completed)
    expect(consulted).toHaveLength(1)
    expect(
      firstRig.record.eventsOf(THREAD).filter((event) => event.type === 'tool-denied'),
    ).toHaveLength(1)
  })

  it('a recorded notBefore is read back and waited out, not re-decided', async () => {
    const ledger = new InMemoryOnceLedger()
    const sleptFor: number[] = []
    const rig = rigOf({
      script: [{ throws: new Error('connection reset') }, { text: 'recovered' }],
      overrides: {
        onceLedger: ledger,
        normalizeFailure: transientFailure,
        retry: {
          jitter: () => 0,
          sleep: async ({ ms }) => {
            sleptFor.push(ms)
          },
        },
      },
    })

    const outcome = await rig.runner.say({ threadId: THREAD, text: 'go' })
    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(sleptFor).toHaveLength(1)
    expect(sleptFor[0]).toBeGreaterThan(0)

    const keys = [...(ledger as unknown as { facts: Map<string, unknown> }).facts.keys()]
    const retryKey = keys.find((key) => key.startsWith('retry:'))
    expect(retryKey).toBeDefined()

    let decided = 0
    const recalled = await ledger.once({
      key: retryKey ?? 'retry:none',
      decide: async () => {
        decided += 1
        return -1
      },
    })
    expect(decided).toBe(0)
    expect(typeof recalled).toBe('number')
    expect(recalled).toBeGreaterThan(0)
  })
})
