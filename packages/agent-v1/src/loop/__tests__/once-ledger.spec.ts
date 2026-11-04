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

  it('reads a recorded retry deadline back instead of deciding it again', async () => {
    const ledger = new InMemoryOnceLedger()
    const key = 'retry:run-1:0:1'

    let decided = 0
    const notBefore = await ledger.once({
      key,
      decide: async () => {
        decided += 1
        return Date.now() + 500
      },
    })
    expect(decided).toBe(1)
    expect(ledger.has(key)).toBe(true)

    const recalled = await ledger.once({
      key,
      decide: async () => {
        decided += 1
        return -1
      },
    })
    expect(decided).toBe(1)
    expect(recalled).toBe(notBefore)
  })

  it('re-decides when the first decision rejects', async () => {
    const ledger = new InMemoryOnceLedger()
    const key = 'hook:guard:run-1:call-1'

    let attempts = 0
    await expect(
      ledger.once({
        key,
        decide: async () => {
          attempts += 1
          throw new Error('hook blew up')
        },
      }),
    ).rejects.toThrow('hook blew up')
    expect(ledger.has(key)).toBe(false)

    const value = await ledger.once({
      key,
      decide: async () => {
        attempts += 1
        return 'allowed'
      },
    })
    expect(attempts).toBe(2)
    expect(value).toBe('allowed')
    expect(ledger.has(key)).toBe(true)
  })
})
