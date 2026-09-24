import { beforeEach, describe, expect, it } from 'bun:test'

import { toRunId, type Event } from '@dltech/atlas-core'
import {
  createDeltaChannel,
  EStepEnd,
  type DeltaChannel,
  type TurnSpend,
} from '@dltech/atlas-harness'

import { createConversationStore, type ConversationStore } from '../conversation-store'
import { EEntryKind } from '../transcript-model'
import { fixtureThreadId, log } from './fixture'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const A_FRAME_OR_TWO = 60

const textOf = (store: ConversationStore) => store.getSnapshot().entries.map((entry) => entry.text)

const answersOf = (store: ConversationStore) =>
  store
    .getSnapshot()
    .entries.filter((entry) => entry.kind === EEntryKind.ModelSaid)
    .map((entry) => entry.text)

describe('the conversation store', () => {
  let channel: DeltaChannel
  let store: ConversationStore

  beforeEach(() => {
    channel = createDeltaChannel()
    store = createConversationStore({ channel, threadId: fixtureThreadId })
  })

  it('opens on a usable empty transcript for a thread with nothing in it', () => {
    expect(store.getSnapshot().isEmpty).toBe(true)
    expect(store.getSnapshot().entries).toEqual([])
  })

  it('returns the same snapshot until something changes', () => {
    const first = store.getSnapshot()

    expect(store.getSnapshot()).toBe(first)

    store.setEvents({ events: log([{ type: 'user-said', text: 'hello' }]) })

    expect(store.getSnapshot()).not.toBe(first)
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('notifies subscribers when events land and when deltas arrive', async () => {
    let notices = 0
    store.subscribe(() => void (notices += 1))

    store.setEvents({ events: log([{ type: 'user-said', text: 'hello' }]) })
    const afterEvents = notices
    channel
      .publisherFor({ threadId: fixtureThreadId })
      .onChunk({ type: 'text-delta', id: 'b1', text: 'hi' })

    await sleep(A_FRAME_OR_TWO)

    expect(afterEvents).toBeGreaterThan(0)
    expect(notices).toBeGreaterThan(afterEvents)
    expect(textOf(store)).toEqual(['hello', 'hi'])
  })

  it('drops every in-flight step on resetSteps, so a rewind leaves nothing half-drawn', async () => {
    channel
      .publisherFor({ threadId: fixtureThreadId })
      .onChunk({ type: 'text-delta', id: 'b1', text: 'half said' })

    await sleep(A_FRAME_OR_TWO)

    expect(textOf(store)).toEqual(['half said'])

    store.resetSteps()

    expect(store.getSnapshot().entries).toEqual([])
  })

  it('shows the reply exactly once across a real commit handoff', async () => {
    const question = log([{ type: 'user-said', text: 'hello' }])
    const durable: Event[] = log([
      { type: 'user-said', text: 'hello' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'hi there' }] },
    ])
    const reply = durable[1]
    if (reply === undefined) throw new Error('fixture lost its reply')

    store.setEvents({ events: question })
    const publisher = channel.publisherFor({ threadId: fixtureThreadId })
    publisher.onChunk({ type: 'text-delta', id: 'b1', text: 'hi ' })
    publisher.onChunk({ type: 'text-delta', id: 'b1', text: 'there' })

    await sleep(A_FRAME_OR_TWO)

    const seen = [answersOf(store)]
    publisher.settleAppend({ events: [reply] })
    seen.push(answersOf(store))
    store.setEvents({ events: durable })
    seen.push(answersOf(store))

    expect(seen).toEqual([['hi there'], ['hi there'], ['hi there']])
  })

  it('leaves no ghost of a settled step behind when the next one streams', async () => {
    const durable = log([{ type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }])
    const reply = durable[0]
    if (reply === undefined) throw new Error('fixture lost its reply')

    const publisher = channel.publisherFor({ threadId: fixtureThreadId })
    publisher.onChunk({ type: 'text-delta', id: 'b1', text: 'done' })
    publisher.settleAppend({ events: [reply] })
    store.setEvents({ events: durable })
    channel
      .publisherFor({ threadId: fixtureThreadId })
      .onChunk({ type: 'text-delta', id: 'b2', text: 'again' })

    await sleep(A_FRAME_OR_TWO)

    expect(textOf(store)).toEqual(['done', 'again'])
  })

  it('paints a burst of chunks in one commit rather than one per chunk', async () => {
    let notices = 0
    store.subscribe(() => void (notices += 1))

    const publisher = channel.publisherFor({ threadId: fixtureThreadId })
    for (const text of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      publisher.onChunk({ type: 'text-delta', id: 'b1', text })
    }

    expect(notices).toBe(1)

    await sleep(A_FRAME_OR_TWO)

    expect(notices).toBe(2)
    expect(textOf(store)).toEqual(['abcdefgh'])
  })

  it('stops following the channel once disposed', () => {
    store.dispose()
    channel
      .publisherFor({ threadId: fixtureThreadId })
      .onChunk({ type: 'text-delta', id: 'b1', text: 'hi' })

    expect(store.getSnapshot().isEmpty).toBe(true)
  })
})

describe('a failure the store is holding on screen', () => {
  let channel: DeltaChannel
  let store: ConversationStore

  beforeEach(() => {
    channel = createDeltaChannel()
    store = createConversationStore({ channel, threadId: fixtureThreadId })
  })

  const failAStep = () => {
    const publisher = channel.publisherFor({ threadId: fixtureThreadId })
    publisher.onChunk({ type: 'text-delta', id: 'b1', text: 'part way' })
    publisher.onChunk({ type: 'error', message: 'The operation timed out.' })
    publisher.close({ end: EStepEnd.Failed })
  }

  it('stays put while nothing has superseded it', () => {
    failAStep()

    expect(store.getSnapshot().failure).toEqual({ message: 'The operation timed out.' })
  })

  it('is retired the moment a retry takes over, so the working line can show', () => {
    failAStep()
    store.supersedeFailure()

    expect(store.getSnapshot().failure).toBeNull()
  })

  it('notifies subscribers when it is retired, and only when there was one', () => {
    let notices = 0
    failAStep()
    store.subscribe(() => void (notices += 1))

    store.supersedeFailure()
    const afterRetiring = notices
    store.supersedeFailure()

    expect(afterRetiring).toBe(1)
    expect(notices).toBe(1)
  })
})

describe('the store lets the composition root fold the same log', () => {
  it('projects the log it was opened on, before any turn runs', () => {
    const seen: number[] = []
    createConversationStore({
      channel: createDeltaChannel(),
      threadId: fixtureThreadId,
      events: log([{ type: 'user-said', text: 'resumed' }]),
      projectEvents: ({ events }) => void seen.push(events.length),
    })

    expect(seen).toEqual([1])
  })

  it('projects again whenever the log changes', () => {
    const seen: number[] = []
    const opened = createConversationStore({
      channel: createDeltaChannel(),
      threadId: fixtureThreadId,
      projectEvents: ({ events }) => void seen.push(events.length),
    })

    opened.setEvents({ events: log([{ type: 'user-said', text: 'one' }]) })
    opened.setEvents({
      events: log([
        { type: 'user-said', text: 'one' },
        { type: 'user-said', text: 'two' },
      ]),
    })

    expect(seen).toEqual([0, 1, 2])
  })

  it('hands the projection the same array the sidebar was derived from', () => {
    const projected: (readonly Event[])[] = []
    const events = log([{ type: 'user-said', text: 'one' }])
    const opened = createConversationStore({
      channel: createDeltaChannel(),
      threadId: fixtureThreadId,
      projectEvents: ({ events: folded }) => void projected.push(folded),
    })

    opened.setEvents({ events })

    expect(projected.at(-1)).toBe(events)
  })
})

describe('the naming flag the store carries to the sidebar', () => {
  let channel: DeltaChannel
  let store: ConversationStore

  beforeEach(() => {
    channel = createDeltaChannel()
    store = createConversationStore({ channel, threadId: fixtureThreadId })
  })

  it('opens with no naming flag set', () => {
    expect(store.getSidebar().naming).toBeUndefined()
  })

  it('marks the sidebar while the titler is being asked, and clears it once settled', () => {
    store.setNaming(true)
    expect(store.getSidebar().naming).toBe(true)

    store.setNaming(false)
    expect(store.getSidebar().naming).toBeUndefined()
  })

  it('wakes subscribers only when the flag actually moves', () => {
    let notices = 0
    store.subscribe(() => void (notices += 1))

    store.setNaming(false)
    expect(notices).toBe(0)

    store.setNaming(true)
    expect(notices).toBe(1)

    store.setNaming(true)
    expect(notices).toBe(1)
  })

  it('keeps the sidebar snapshot identical when the flag does not move', () => {
    const before = store.getSidebar()

    store.setNaming(false)

    expect(store.getSidebar()).toBe(before)
  })

  it('drops the flag once a name lands, since the title is no longer the fallback', () => {
    store.setNaming(true)
    store.setName('A real title')

    expect(store.getSidebar().naming).toBeUndefined()
    expect(store.getSidebar().title).toBe('A real title')
  })
})

describe('a refresh that re-read the same log', () => {
  let channel: DeltaChannel
  let store: ConversationStore

  const spend: TurnSpend = {
    runId: toRunId('run-1'),
    threadId: fixtureThreadId,
    status: 'completed',
    providerId: 'anthropic',
    modelId: 'claude-opus-5',
    steps: 2,
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 50,
    cacheWriteTokens: 10,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    durationMs: 60_000,
  }

  beforeEach(() => {
    channel = createDeltaChannel()
    store = createConversationStore({ channel, threadId: fixtureThreadId })
  })

  it('wakes nobody when the read returns the same rows in a fresh array', () => {
    const events = log([{ type: 'user-said', text: 'hello' }])
    store.setEvents({ events })
    const before = store.getSnapshot()

    let notices = 0
    store.subscribe(() => void (notices += 1))
    store.setEvents({ events: [...events] })

    expect(notices).toBe(0)
    expect(store.getSnapshot()).toBe(before)
  })

  it('wakes nobody when the spend comes back as fresh rows saying the same thing', () => {
    const events = log([{ type: 'user-said', text: 'hello' }])
    store.setEvents({ events, turns: [spend] })

    let notices = 0
    store.subscribe(() => void (notices += 1))
    store.setEvents({ events: [...events], turns: [{ ...spend }] })

    expect(notices).toBe(0)
  })

  it('wakes the view when the spend moved', () => {
    const events = log([{ type: 'user-said', text: 'hello' }])
    store.setEvents({ events, turns: [spend] })

    let notices = 0
    store.subscribe(() => void (notices += 1))
    store.setEvents({
      events: [...events],
      turns: [{ ...spend, outputTokens: spend.outputTokens + 50 }],
    })

    expect(notices).toBe(1)
  })

  it('still wakes the view the moment a row actually lands', () => {
    const events = log([{ type: 'user-said', text: 'hello' }])
    store.setEvents({ events })

    let notices = 0
    store.subscribe(() => void (notices += 1))
    store.setEvents({
      events: [...events, ...log([{ type: 'user-said', text: 'again' }])],
    })

    expect(notices).toBe(1)
  })
})
