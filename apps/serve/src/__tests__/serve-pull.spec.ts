import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type Event } from '@dltech/atlas-core'

import { EServeEvent, type ServeLogLine } from '../serve-log'
import { bindServePull, type PullSubscribe } from '../serve-pull'

const threadId = toThreadId('thread-pull')
const env = { ATLAS_API_PROVISIONED: '1' }
const remote = {
  controlPlaneUrl: 'https://api.example.com',
  token: 'serve-token',
  clientVersion: 'test',
  fetchFn: fetch,
}

const eventOf = (args: { seq: number; type: 'user-said' | 'assistant-said' }): Event =>
  ({
    id: toEventId(`ev-${args.seq}`),
    threadId,
    seq: args.seq,
    runId: toRunId('run-1'),
    depth: 0,
    at: '2026-10-29T00:00:00.000Z',
    type: args.type,
    text: `m${args.seq}`,
  }) as Event

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
}

const setup = (
  args: { tail?: Event[]; busy?: boolean; env?: Record<string, string | undefined> } = {},
) => {
  const runs: unknown[] = []
  const lines: ServeLogLine[] = []
  const ticks: Array<() => void> = []
  const hydrates = { calls: 0, next: async (): Promise<unknown> => undefined }
  let detached = 0
  const subscribe: PullSubscribe = ({ onTick }) => {
    ticks.push(onTick)
    return () => {
      detached += 1
    }
  }
  const tail = args.tail ?? [eventOf({ seq: 1, type: 'user-said' })]
  const detach = bindServePull({
    env: args.env ?? env,
    threadId,
    atlasHome: '/tmp/unused',
    remote,
    app: { log: { readOwn: async () => tail, refresh: async () => undefined } },
    driver: {
      run: (options) => {
        runs.push(options)
      },
      busy: () => args.busy === true,
    },
    log: (line) => lines.push(line),
    hydrate: () => {
      hydrates.calls += 1
      return hydrates.next()
    },
    subscribe,
  })
  const tick = (): void => {
    for (const onTick of ticks) onTick()
  }
  return {
    runs,
    lines,
    tick,
    hydrates,
    detach,
    subscribed: () => ticks.length,
    detached: () => detached,
  }
}

describe('bindServePull', () => {
  it('runs an idle driver once when a pulled user-said awaits a reply', async () => {
    const pull = setup()
    pull.tick()
    await settle()
    expect(pull.hydrates.calls).toBe(1)
    expect(pull.runs).toEqual([{ resume: false, onlyIfIdle: true }])
  })

  it('does not run when the tail is an assistant reply', async () => {
    const pull = setup({
      tail: [eventOf({ seq: 1, type: 'user-said' }), eventOf({ seq: 2, type: 'assistant-said' })],
    })
    pull.tick()
    await settle()
    expect(pull.runs).toEqual([])
  })

  it('does not run while a turn is in flight', async () => {
    const pull = setup({ busy: true })
    pull.tick()
    await settle()
    expect(pull.hydrates.calls).toBe(1)
    expect(pull.runs).toEqual([])
  })

  it('coalesces ticks during one in-flight hydrate into a single follow-up pull', async () => {
    const pull = setup()
    let release: () => void = () => undefined
    pull.hydrates.next = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    pull.tick()
    await settle()
    pull.tick()
    pull.tick()
    pull.tick()
    expect(pull.hydrates.calls).toBe(1)
    pull.hydrates.next = async () => undefined
    release()
    await settle()
    expect(pull.hydrates.calls).toBe(2)
    await settle()
    expect(pull.hydrates.calls).toBe(2)
  })

  it('does nothing when the thread state is not mirrored', () => {
    const pull = setup({ env: {} })
    expect(pull.subscribed()).toBe(0)
    pull.detach()
    expect(pull.detached()).toBe(0)
  })

  it('logs a failed pull and keeps pulling on later ticks', async () => {
    const pull = setup()
    pull.hydrates.next = async () => {
      throw new Error('api down')
    }
    pull.tick()
    await settle()
    expect(pull.lines).toContainEqual(
      expect.objectContaining({ event: EServeEvent.PullFailed, reason: 'api down' }),
    )
    expect(pull.runs).toEqual([])

    pull.hydrates.next = async () => undefined
    pull.tick()
    await settle()
    expect(pull.hydrates.calls).toBe(2)
    expect(pull.runs).toEqual([{ resume: false, onlyIfIdle: true }])
  })

  it('unsubscribes on detach and ignores later ticks', async () => {
    const pull = setup()
    pull.detach()
    pull.tick()
    await settle()
    expect(pull.detached()).toBe(1)
    expect(pull.hydrates.calls).toBe(0)
  })
})
