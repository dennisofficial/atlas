import { ECloudSetting, readResource } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { watchIdOf } from '../plugin-resource-probes'
import { pluginResourcesHook } from '../plugin-resources'
import {
  DIRECTORY,
  THREAD,
  agentsRootOf,
  rig,
  snapshotEventOf,
  stringResource,
  versionsAt,
  type Rig,
} from './plugin-resources-rig'

const WAIT_MS = 200
const TICK_MS = 20

const turnStartOf = async (turn: Rig): Promise<void> => {
  await pluginResourcesHook({ sync: turn.sync }).run({
    threadId: THREAD,
    projectDirectory: DIRECTORY,
  })
}

const gateOf = (): { promise: Promise<string>; open(value: string): void } => {
  let open = (_value: string): void => undefined
  const promise = new Promise<string>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

const sleep = (ms: number): Promise<undefined> =>
  new Promise((resolve) => setTimeout(() => resolve(undefined), ms))

const lastFingerprintOf = (turn: Rig): string | undefined => {
  const loaded = turn.events.flatMap((event) =>
    event.type === 'resource-loaded' ? [event.fingerprint] : [],
  )
  return loaded[loaded.length - 1]
}

describe('a turn that has no snapshot of its own', () => {
  it('adopts the shared snapshot and returns while the pod stays blocked', async () => {
    const loads: string[] = []
    const pod = gateOf()
    const sharedEvents = [
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-0:5::${DIRECTORY}`,
        value: 'shared',
      }),
    ]
    const resource = stringResource({ name: 'skills', loads, value: () => 'own', watch: true })
    const turn = rig({
      resources: [resource],
      shared: () => sharedEvents,
      beforeCall: async () => {
        await pod.promise
      },
    })

    turn.sync.start()
    const started = Date.now()
    await turnStartOf(turn)
    const waited = Date.now() - started

    expect(waited).toBeLessThan(WAIT_MS)
    expect(loads).toEqual([])
    expect(lastFingerprintOf(turn)).toBe(`instance-0:5::${DIRECTORY}`)
    expect(readResource({ ctx: turn.ctx, resource })).toBe('shared')

    pod.open('')
    await turn.settled()

    expect(loads).toEqual(['skills'])
    expect(lastFingerprintOf(turn)).toBe(`instance-1:0::${DIRECTORY}`)
    expect(readResource({ ctx: turn.ctx, resource })).toBe('own')
  }, 10_000)

  it('waits for the refresh when the shared snapshot is under another cloud version', async () => {
    const loads: string[] = []
    const pod = gateOf()
    const sharedEvents = [
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-0:5:v1:${DIRECTORY}`,
        value: 'shared',
      }),
    ]
    const resource = stringResource({
      name: 'skills',
      loads,
      value: () => 'own',
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const turn = rig({
      resources: [resource],
      shared: () => sharedEvents,
      beforeCall: async () => {
        await pod.promise
      },
    })
    turn.daemon.setVersions(versionsAt('v2'))

    let returned = false
    turn.sync.start()
    const started = turnStartOf(turn).then(() => {
      returned = true
    })
    await sleep(TICK_MS)

    expect(returned).toBe(false)
    expect(turn.events).toEqual([])

    pod.open('')
    await started
    await turn.settled()

    expect(loads).toEqual(['skills'])
    expect(lastFingerprintOf(turn)).toBe(`instance-1:0:v2:${DIRECTORY}`)
  }, 10_000)
  it('records the shared snapshot once when a refresh round runs alongside it', async () => {
    const loads: string[] = []
    const appending = gateOf()
    const sharedEvents = [
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-1:0::${DIRECTORY}`,
        value: 'shared',
      }),
    ]
    const resource = stringResource({ name: 'skills', loads, value: () => 'own', watch: true })
    const turn = rig({
      resources: [resource],
      shared: () => sharedEvents,
      beforeAppend: async () => {
        await appending.promise
      },
    })
    turn.daemon.seqs.set(watchIdOf({ roots: [agentsRootOf(DIRECTORY)] }), 0)

    turn.sync.start()
    const started = turnStartOf(turn)
    await sleep(TICK_MS)
    appending.open('')
    await started
    await turn.settled()

    const loaded = turn.events.flatMap((event) =>
      event.type === 'resource-loaded' ? [event.fingerprint] : [],
    )
    expect(loaded).toEqual([`instance-1:0::${DIRECTORY}`])
    expect(loads).toEqual([])
  }, 10_000)

  it('does not adopt a shared snapshot the resource calls stale', async () => {
    const loads: string[] = []
    const sharedEvents = [
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-1:0::${DIRECTORY}`,
        value: 'shared',
      }),
    ]
    const resource = stringResource({
      name: 'skills',
      loads,
      value: () => 'own',
      watch: true,
      stale: () => true,
    })
    const turn = rig({ resources: [resource], shared: () => sharedEvents })

    await turn.run()

    const loaded = turn.events.flatMap((event) =>
      event.type === 'resource-loaded' ? [event.value] : [],
    )
    expect(loaded).toEqual(['own'])
    expect(readResource({ ctx: turn.ctx, resource })).toBe('own')
  }, 10_000)
  it('adopts the shared snapshot of a newer instance over the snapshot it already holds', async () => {
    const loads: string[] = []
    const sharedEvents = [
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-1:1::${DIRECTORY}`,
        value: 'shared',
      }),
    ]
    const resource = stringResource({ name: 'skills', loads, value: () => 'own', watch: true })
    const turn = rig({ resources: [resource], shared: () => sharedEvents })
    turn.daemon.seqs.set(watchIdOf({ roots: [agentsRootOf(DIRECTORY)] }), 1)
    turn.events.push(
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-1:0::${DIRECTORY}`,
        value: 'old',
      }),
    )

    await turn.run()

    expect(readResource({ ctx: turn.ctx, resource })).toBe('shared')
    expect(loads).toEqual([])
  }, 10_000)

  it('appends a matching shared snapshot of a background resource into an empty log', async () => {
    const loads: string[] = []
    const sharedEvents = [
      snapshotEventOf({
        resource: 'mcp-tools',
        fingerprint: `instance-1:0::${DIRECTORY}`,
        value: 'shared',
      }),
    ]
    const resource = stringResource({
      name: 'mcp-tools',
      loads,
      value: () => 'own',
      watch: true,
      background: true,
    })
    const turn = rig({ resources: [resource], shared: () => sharedEvents })
    turn.daemon.seqs.set(watchIdOf({ roots: [agentsRootOf(DIRECTORY)] }), 0)

    await turn.run()

    const loaded = turn.events.flatMap((event) =>
      event.type === 'resource-loaded' ? [event.value] : [],
    )
    expect(loaded).toEqual(['shared'])
    expect(loads).toEqual([])
  }, 10_000)
})
