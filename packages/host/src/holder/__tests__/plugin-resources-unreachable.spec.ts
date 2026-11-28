import { readResource } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { ReadyTimeoutError } from '../../calls/errors'
import { watchIdOf } from '../plugin-resource-probes'
import { DIRECTORY, agentsRootOf, rig, skillsOf, stringResource } from './plugin-resources-rig'

const TICK_MS = 20
const TIMEOUT_MS = 60_000
const WATCH_ID = watchIdOf({ roots: [agentsRootOf(DIRECTORY)] })

type Gate = { readonly promise: Promise<void>; open(): void }

const gateOf = (): Gate => {
  let open: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open: () => open() }
}

const sleep = (ms: number): Promise<undefined> =>
  new Promise((resolve) => setTimeout(() => resolve(undefined), ms))

describe('a round that the sandbox never answers', () => {
  it('refreshes on the next hello even when the daemon did not restart', async () => {
    const loads: string[] = []
    const skills = stringResource({ name: 'skills', loads, value: () => 'one', watch: true })
    const turn = rig({ resources: [skills] })
    turn.daemon.failStatus(new ReadyTimeoutError(TIMEOUT_MS))
    await turn.run()
    expect(loads).toEqual([])

    turn.daemon.failStatus(undefined)
    turn.calls.length = 0
    turn.reconnect(false)
    await turn.settled()

    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('one')
  })

  it('leaves a reload for the next hello when its status call times out', async () => {
    const loads: string[] = []
    let value = 'one'
    const skills = skillsOf(loads, { value: () => value })
    const turn = rig({ resources: [skills] })
    await turn.run()
    expect(loads).toEqual(['skills'])

    turn.calls.length = 0
    turn.daemon.failStatus(new ReadyTimeoutError(TIMEOUT_MS))
    turn.daemon.seqs.set(WATCH_ID, 1)
    turn.changed(WATCH_ID)
    await turn.settled()

    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status'])
    expect(loads).toEqual(['skills'])

    value = 'two'
    turn.daemon.failStatus(undefined)
    turn.reconnect(false)
    await turn.settled()

    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('two')
    expect(loads).toEqual(['skills', 'skills'])
    const loaded = turn.events.flatMap((event) =>
      event.type === 'resource-loaded' ? [event.fingerprint] : [],
    )
    expect(loaded[loaded.length - 1]).toBe(`instance-1:1::${DIRECTORY}`)
  })

  it('runs the retry round a hello asked for while the status call was pending', async () => {
    const loads: string[] = []
    const status = gateOf()
    let failing = true
    const skills = stringResource({ name: 'skills', loads, value: () => 'one', watch: true })
    const turn = rig({
      resources: [skills],
      beforeCall: async (op) => {
        if (op.op !== 'watch.status' || !failing) return
        await status.promise
        throw new ReadyTimeoutError(TIMEOUT_MS)
      },
    })

    turn.sync.start()
    await sleep(TICK_MS)

    turn.reconnect(false)
    failing = false
    status.open()
    await turn.settled()

    expect(turn.calls.filter((call) => call.op === 'watch.status')).toHaveLength(1)
    expect(loads).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('one')
  }, 10_000)
})
