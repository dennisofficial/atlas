import { afterEach, describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { ECompactionAnchor, toRunId, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { compactThread, ECompactionFailure, type Summarise } from '../compact'
import { openStoreFixture, type StoreFixture } from './harness'

let fixture: StoreFixture

const runId = toRunId('run-1')

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const OPENING = [said('one'), replied('two'), said('three'), replied('four')] as const

const PROMPT_MS = 250

type Gate = {
  summarise: Summarise
  entered: Promise<void>
  release: (summary: string | null) => void
  fail: (fault: Error) => void
  sawSignal: () => AbortSignal | undefined
}

const ignoringModel = (): Gate => {
  let release: (summary: string | null) => void = () => undefined
  let fail: (fault: Error) => void = () => undefined
  let enter: () => void = () => undefined
  let seen: AbortSignal | undefined

  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const held = new Promise<string | null>((resolve, reject) => {
    release = resolve
    fail = reject
  })

  return {
    summarise: (args) => {
      seen = args.signal
      enter()
      return held
    },
    entered,
    release,
    fail,
    sawSignal: () => seen,
  }
}

const openThread = async (drafts: readonly EventDraft[]): Promise<ThreadId> => {
  fixture = await openStoreFixture()
  const thread = await fixture.threads.create({ title: 'work' })
  await fixture.log.append({ threadId: thread.id, runId, drafts })
  return thread.id
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })

const snapshotOfDisk = (): Record<string, string> =>
  Object.fromEntries(filesUnder(fixture.home).map((path) => [path, readFileSync(path, 'utf8')]))

const compactIgnoring = ({
  threadId,
  summarise,
  signal,
  destructive,
}: {
  threadId: ThreadId
  summarise: Summarise
  signal: AbortSignal
  destructive: boolean
}) =>
  compactThread({
    log: fixture.log,
    threads: fixture.threads,
    agents: fixture.agents,
    threadId,
    anchor: ECompactionAnchor.Prefix,
    seq: 2,
    destructive,
    summarise,
    signal,
  })

const idle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  await fixture.close()
})

describe('cancelling a compaction whose model ignores the abort', () => {
  for (const destructive of [false, true]) {
    const label = destructive ? 'summarise' : 'compact'

    it(`frees the ${label} promptly, before the model returns`, async () => {
      const threadId = await openThread([...OPENING])
      const model = ignoringModel()
      const controller = new AbortController()
      const reason = new Error('operator stopped it')

      const pending = compactIgnoring({
        threadId,
        summarise: model.summarise,
        signal: controller.signal,
        destructive,
      })
      const rejected = pending.then(
        () => undefined,
        (fault: unknown) => fault,
      )

      await model.entered
      const startedAt = performance.now()
      controller.abort(reason)

      expect(await rejected).toBe(reason)
      expect(performance.now() - startedAt).toBeLessThan(PROMPT_MS)
      expect(model.sawSignal()).toBe(controller.signal)
    })

    it(`leaves the history byte-identical when the ignored ${label} resolves late`, async () => {
      const threadId = await openThread([...OPENING])
      const before = snapshotOfDisk()
      const eventsBefore = await fixture.log.read({ threadId })
      const model = ignoringModel()
      const controller = new AbortController()

      const pending = compactIgnoring({
        threadId,
        summarise: model.summarise,
        signal: controller.signal,
        destructive,
      })
      const rejected = pending.catch(() => undefined)

      await model.entered
      controller.abort(new Error('stopped'))
      await rejected

      model.release('a summary that arrived too late')
      await idle(50)

      expect(await fixture.log.read({ threadId })).toEqual(eventsBefore)
      expect(snapshotOfDisk()).toEqual(before)
    })

    it(`leaves the history byte-identical when the ignored ${label} rejects late`, async () => {
      const threadId = await openThread([...OPENING])
      const before = snapshotOfDisk()
      const model = ignoringModel()
      const controller = new AbortController()
      const unhandled: unknown[] = []
      const handleUnhandled = (fault: unknown): void => {
        unhandled.push(fault)
      }
      process.on('unhandledRejection', handleUnhandled)

      try {
        const pending = compactIgnoring({
          threadId,
          summarise: model.summarise,
          signal: controller.signal,
          destructive,
        })
        const rejected = pending.catch(() => undefined)

        await model.entered
        controller.abort(new Error('stopped'))
        await rejected

        model.fail(new Error('provider fell over after the abort'))
        await idle(50)
      } finally {
        process.off('unhandledRejection', handleUnhandled)
      }

      expect(unhandled).toEqual([])
      expect(snapshotOfDisk()).toEqual(before)
    })
  }

  it('writes nothing when the signal is already aborted, and never asks the model', async () => {
    const threadId = await openThread([...OPENING])
    const before = snapshotOfDisk()
    const controller = new AbortController()
    controller.abort(new Error('already stopped'))
    let asked = false

    const outcome = await compactIgnoring({
      threadId,
      summarise: async () => {
        asked = true
        return 'never wanted'
      },
      signal: controller.signal,
      destructive: true,
    }).then(
      () => 'resolved',
      () => 'rejected',
    )

    expect(outcome).toBe('rejected')
    expect(asked).toBe(false)
    expect(snapshotOfDisk()).toEqual(before)
  })

  it('writes nothing when the abort lands after the summary arrived but before the write', async () => {
    const threadId = await openThread([...OPENING])
    const before = snapshotOfDisk()
    const controller = new AbortController()

    const outcome = await compactIgnoring({
      threadId,
      summarise: async () => {
        controller.abort(new Error('stopped as it answered'))
        return 'a summary'
      },
      signal: controller.signal,
      destructive: true,
    }).then(
      () => 'resolved',
      () => 'rejected',
    )

    expect(outcome).toBe('rejected')
    expect(snapshotOfDisk()).toEqual(before)
  })
})

describe('a compaction nobody cancels', () => {
  it('still writes the summary through a live signal', async () => {
    const threadId = await openThread([...OPENING])
    const controller = new AbortController()

    const outcome = await compactIgnoring({
      threadId,
      summarise: async () => 'the opening',
      signal: controller.signal,
      destructive: true,
    })

    expect(outcome).toMatchObject({ ok: true, replaced: 2, summary: 'the opening' })
    expect((await fixture.log.read({ threadId })).map((event) => [event.seq, event.type])).toEqual([
      [2, 'history-compacted'],
      [3, 'user-said'],
      [4, 'assistant-said'],
    ])
  })

  it('still reports a summariser that returned nothing', async () => {
    const threadId = await openThread([...OPENING])

    const outcome = await compactIgnoring({
      threadId,
      summarise: async () => null,
      signal: new AbortController().signal,
      destructive: false,
    })

    expect(outcome).toMatchObject({ ok: false, failure: ECompactionFailure.NoSummary })
  })
})
