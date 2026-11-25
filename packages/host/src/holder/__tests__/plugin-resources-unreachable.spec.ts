import { ECloudSetting, readResource } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { watchIdOf } from '../plugin-resource-probes'
import { DIRECTORY, agentsRootOf, rig, skillsOf, stringResource } from './plugin-resources-rig'

const TICK_MS = 20
const WATCH_ID = watchIdOf({ roots: [agentsRootOf(DIRECTORY)] })

type Gate = { readonly promise: Promise<string>; open(value: string): void }

const gateOf = (): Gate => {
  let open = (_value: string): void => undefined
  const promise = new Promise<string>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

const sleep = (ms: number): Promise<undefined> =>
  new Promise((resolve) => setTimeout(() => resolve(undefined), ms))

const untilLoad = async (loads: readonly string[], name: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (loads.includes(name)) return
    await sleep(1)
  }
}

describe('a refresh round that cannot reach the pod', () => {
  it('skips the arms and the loads of watched resources', async () => {
    const loads: string[] = []
    const skills = stringResource({ name: 'skills', loads, value: () => 'one', watch: true })
    const index = stringResource({ name: 'memory-index', loads, value: () => 'index' })
    const turn = rig({ resources: [skills, index] })
    turn.daemon.failStatus(new Error('the pod is gone'))

    await turn.run()

    expect(turn.calls.filter((call) => call.op === 'watch.start')).toEqual([])
    expect(loads).toEqual(['memory-index'])
    expect(readResource({ ctx: turn.ctx, resource: index })).toBe('index')
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBeUndefined()
    expect(turn.logs.some((line) => line.includes('could not read watch status'))).toBe(true)
  })

  it('arms and loads on the next hello even when the daemon did not restart', async () => {
    const loads: string[] = []
    const skills = stringResource({ name: 'skills', loads, value: () => 'one', watch: true })
    const turn = rig({ resources: [skills] })
    turn.daemon.failStatus(new Error('the pod is gone'))
    await turn.run()

    turn.daemon.failStatus(undefined)
    turn.calls.length = 0
    turn.reconnect(false)
    await turn.settled()

    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('one')
  })

  it('leaves a reload for the next hello when its status call fails', async () => {
    const loads: string[] = []
    const turn = rig({ resources: [skillsOf(loads)] })
    await turn.run()
    expect(loads).toEqual(['skills'])

    turn.calls.length = 0
    turn.daemon.failStatus(new Error('the pod is gone'))
    turn.daemon.seqs.set(WATCH_ID, 1)
    turn.changed(WATCH_ID)
    await turn.settled()

    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status'])
    expect(loads).toEqual(['skills'])

    turn.daemon.failStatus(undefined)
    turn.reconnect(false)
    await turn.settled()

    expect(loads).toEqual(['skills', 'skills'])
    const loaded = turn.events.flatMap((event) =>
      event.type === 'resource-loaded' ? [event.fingerprint] : [],
    )
    expect(loaded[loaded.length - 1]).toBe(`instance-1:1::${DIRECTORY}`)
  })
  it('runs the retry round a hello asked for while a round was still in flight', async () => {
    const loads: string[] = []
    const index = gateOf()
    const skills = stringResource({ name: 'skills', loads, value: () => 'one', watch: true })
    const slowIndex = stringResource({
      name: 'memory-index',
      loads,
      value: () => 'index',
      pending: index.promise,
    })
    const turn = rig({ resources: [skills, slowIndex] })
    turn.daemon.failStatus(new Error('the pod is gone'))

    turn.sync.start()
    await untilLoad(loads, 'memory-index')
    expect(turn.calls.filter((call) => call.op === 'watch.start')).toEqual([])

    turn.daemon.failStatus(undefined)
    turn.reconnect(false)
    index.open('index')
    await turn.settled()

    expect(turn.calls.filter((call) => call.op === 'watch.status')).toHaveLength(2)
    expect(loads.filter((name) => name === 'skills')).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('one')
  }, 10_000)
  it('retries when a hello arrives before the round has read the watch status', async () => {
    const loads: string[] = []
    const versions = gateOf()
    const skills = stringResource({
      name: 'skills',
      loads,
      value: () => 'one',
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const turn = rig({
      resources: [skills],
      beforeVersions: async () => {
        await versions.promise
      },
    })
    turn.daemon.failStatus(new Error('the pod is gone'))

    turn.sync.start()
    await sleep(TICK_MS)
    expect(turn.calls.filter((call) => call.op === 'watch.status')).toHaveLength(1)

    turn.daemon.failStatus(undefined)
    turn.reconnect(false)
    versions.open('')
    await turn.settled()

    expect(turn.calls.filter((call) => call.op === 'watch.status')).toHaveLength(2)
    expect(loads).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('one')
  }, 10_000)
})
