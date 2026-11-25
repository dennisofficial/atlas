import type { BeforeTurn, RecordEvent } from '@dltech/atlas-core'
import { EStage } from '@dltech/atlas-core'
import type { HookChainArgs, RegisteredHook } from '@dltech/atlas-agent'
import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, postAndRun, seedSession, THREAD_ID } from './holder-rig'

type Rig = Awaited<ReturnType<typeof makeRig>>

const accessHook = (content: () => string): RegisteredHook<BeforeTurn> => ({
  name: 'access',
  order: { stage: EStage.Policy, nudge: 0 },
  awaited: true,
  run: async () => ({
    drafts: [{ type: 'context-loaded', slot: 'access', key: 'current', content: content() }],
  }),
})

const sessionHooks = (content: () => string): HookChainArgs => ({
  beforeTurn: [accessHook(content)],
})

const fullLog = async (rig: Rig): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
  let afterSeq = 0
  for (;;) {
    const page = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq,
      limit: 1000,
      visible: false,
    })
    events.push(...page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}

const noticesOf = async (rig: Rig): Promise<string[]> =>
  (await fullLog(rig)).flatMap((event) => (event.type === 'context-loaded' ? [event.content] : []))

const endedTurns = async (rig: Rig): Promise<number> =>
  (await fullLog(rig)).filter((event) => event.type === 'turn-ended').length

const startSession = async (rig: Rig): Promise<void> => {
  await seedSession(rig)
  await rig.holder.start()
  await rig.wake()
  const prepared = await flushUntil({
    check: async () => (await fullLog(rig)).some((event) => event.type === 'workspace-prepared'),
    clock: rig.clock,
  })
  if (!prepared) throw new Error('the rig session never prepared')
}

const runTurn = async (rig: Rig): Promise<void> => {
  const before = await endedTurns(rig)
  await postAndRun(rig, 'go')
  const ended = await flushUntil({
    check: async () => (await endedTurns(rig)) > before,
    clock: rig.clock,
  })
  if (!ended) throw new Error('the rig turn never ended')
}

describe('SessionRuntime hooks', () => {
  it('records a session-owned context-loaded draft once and dedupes the identical draft next turn', async () => {
    const rig = await makeRig({ hooks: sessionHooks(() => 'Atlas Cloud gives you this access.') })
    await startSession(rig)

    await runTurn(rig)
    expect(await noticesOf(rig)).toEqual(['Atlas Cloud gives you this access.'])

    await runTurn(rig)
    expect(await noticesOf(rig)).toEqual(['Atlas Cloud gives you this access.'])
  })

  it('records one superseding context-loaded event when the session content changes', async () => {
    let content = 'Environment variables: API_KEY'
    const rig = await makeRig({ hooks: sessionHooks(() => content) })
    await startSession(rig)

    await runTurn(rig)
    content = 'Environment variables: API_KEY, GH_TOKEN'
    await runTurn(rig)

    expect(await noticesOf(rig)).toEqual([
      'Environment variables: API_KEY',
      'Environment variables: API_KEY, GH_TOKEN',
    ])
  })
})
