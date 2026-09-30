import { describe, expect, it } from 'bun:test'

import {
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  createDeltaChannel,
  createPendingQueues,
  MessageIntake,
  operatorSource,
  type PendingQueues,
  type TurnOutcome,
} from '@dltech/atlas-harness'
import { ETurnStatus } from '@dltech/atlas-harness'

import { createTurnDriver, type ServeApp } from '../index'

const THREAD = toThreadId('thread-race')
const OTHER = toThreadId('thread-other')

const gate = () => {
  let open = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open: () => open() }
}

const idleOutcome = (): Promise<TurnOutcome> =>
  Promise.resolve({ status: ETurnStatus.Idle, runId: toRunId('run-idle') })

type Rig = {
  driver: ReturnType<typeof createTurnDriver>
  intake: MessageIntake
  pending: PendingQueues
  appended: readonly Event[]
  turnStarted: () => number
  failAppends: (times: number) => void
  gateNextAppend: (held: ReturnType<typeof gate>) => void
}

const rig = (): Rig => {
  const pending = createPendingQueues()
  const intake = new MessageIntake({ sources: [operatorSource(pending)] })
  const appended: Event[] = []
  let seq = 0
  let broken = 0
  let appendGate: ReturnType<typeof gate> | undefined
  const stamp = (draft: EventDraft, threadId: ThreadId): Event => {
    seq += 1
    return {
      ...draft,
      id: toEventId(`ev-${seq}`),
      seq,
      threadId,
      runId: toRunId('run-append'),
      depth: 0,
      at: '2026-09-30T00:00:00.000Z',
    }
  }
  let turnStarted = 0
  const app: ServeApp = {
    channel: createDeltaChannel(),
    intake,
    pending,
    runner: { runTurn: () => idleOutcome(), resume: () => idleOutcome() },
    log: {
      append: async (given: {
        threadId: ThreadId
        drafts: readonly EventDraft[]
      }): Promise<Event[]> => {
        await appendGate?.opened
        if (broken > 0) {
          broken -= 1
          throw new Error('the append fell over')
        }
        const stamped = given.drafts.map((draft) => stamp(draft, given.threadId))
        appended.push(...stamped)
        return stamped
      },
      read: async () => [...appended],
      readOwn: async () => [...appended],
      refresh: async () => undefined,
      head: async () => appended.length,
    },
    threads: {
      find: async () => ({
        id: THREAD,
        head: appended.length,
        createdAt: '2026-09-30T00:00:00.000Z',
        updatedAt: '2026-09-30T00:00:00.000Z',
        workspace: '/workspace',
        repo: null,
      }),
      createWithFirstEvents: async (given) => {
        const threadId = given.threadId ?? THREAD
        appended.push(...given.drafts.map((draft) => stamp(draft, threadId)))
        return {
          thread: {
            id: threadId,
            head: appended.length,
            createdAt: '2026-09-30T00:00:00.000Z',
            updatedAt: '2026-09-30T00:00:00.000Z',
            workspace: '/workspace',
            repo: null,
          },
          events: [] as Event[],
        }
      },
      spawned: async () => [],
      list: async () => [],
      rename: async () => undefined,
      chooseModel: async () => undefined,
      onRename: () => () => undefined,
      onModelChosen: () => () => undefined,
    },
    ids: { nextRunId: () => toRunId('run-append') },
    files: { list: async () => [], forget: () => undefined },
    workspace: { workspace: '/workspace', repo: null },
    adoptChildren: async () => [],
    whenChildrenSettled: async () => undefined,
    close: async () => undefined,
  }
  const driver = createTurnDriver({
    app,
    threadId: THREAD,
    onTurnStarted: () => {
      turnStarted += 1
    },
    onTurnEnded: () => undefined,
    onOutcome: () => undefined,
    onFailure: () => undefined,
  })
  driver.attach(intake)
  return {
    driver,
    intake,
    pending,
    appended,
    turnStarted: () => turnStarted,
    failAppends: (times) => {
      broken = times
    },
    gateNextAppend: (held) => {
      appendGate = held
    },
  }
}

const settleMicrotasks = async (): Promise<void> => {
  for (let lap = 0; lap < 10; lap += 1) await Promise.resolve()
}

const saidTexts = (appended: readonly Event[]): readonly string[] =>
  appended.map((event) => ('text' in event ? String(event.text) : event.type))

describe('a serve turn driver over the shared intake', () => {
  it('holds Run and Resume frames out of the model until the Say commit is done', async () => {
    const { driver, appended, turnStarted, gateNextAppend } = rig()
    const commitHeld = gate()
    gateNextAppend(commitHeld)

    const saying = driver.say({ text: 'held words' })
    await settleMicrotasks()

    driver.run()
    driver.resume()
    await settleMicrotasks()
    expect(turnStarted()).toBe(0)
    expect(appended).toHaveLength(0)

    commitHeld.open()
    await saying
    await settleMicrotasks()
    await driver.settled()

    expect(saidTexts(appended)).toEqual(['held words'])
    expect(turnStarted()).toBe(1)
  })

  it('keeps a failed commit typed, and the next send retries it adjacent to its context', async () => {
    const { driver, pending, appended, failAppends } = rig()
    const context: EventDraft = { type: 'nudge', text: 'queued context', lifetimeSteps: 1 }
    failAppends(1)

    await expect(driver.say({ text: 'typed words', context: [context] })).rejects.toThrow(
      'the append fell over',
    )

    expect(appended).toHaveLength(0)
    expect(
      pending.forThread({ threadId: THREAD }).getSnapshot().map((entry) => entry.text),
    ).toEqual(['typed words'])
    expect(driver.running()).toBe(false)

    await driver.say({ text: 'second words' })
    await driver.settled()

    expect(pending.forThread({ threadId: THREAD }).getSnapshot()).toHaveLength(0)
    expect(saidTexts(appended)).toEqual(['queued context', 'typed words', 'second words'])
    const types = appended.map((event) => event.type)
    expect(types.indexOf('nudge')).toBe(types.indexOf('user-said') - 1)
  })

  it('commits only its own thread when another thread holds queued input', async () => {
    const { driver, intake, pending, appended } = rig()
    intake.submit({ threadId: OTHER, text: 'not yours' })

    await driver.say({ text: 'mine' })
    await driver.settled()

    expect(saidTexts(appended)).toEqual(['mine'])
    expect(pending.forThread({ threadId: OTHER }).getSnapshot()).toHaveLength(1)
    expect(pending.forThread({ threadId: THREAD }).getSnapshot()).toHaveLength(0)
  })
})
