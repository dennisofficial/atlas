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
const WATCH_ID = watchIdOf({ roots: [agentsRootOf(DIRECTORY)] })

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

const loadedFingerprintsOf = (turn: Rig): (string | undefined)[] =>
  turn.events.flatMap((event) => (event.type === 'resource-loaded' ? [event.fingerprint] : []))

describe('a turn whose snapshot is out of date', () => {
  it('waits for the changed resource only, not for a slow unrelated load', async () => {
    const loads: string[] = []
    const unrelated = gateOf()
    const skills = stringResource({
      name: 'skills',
      loads,
      value: () => 'two',
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const crewOptions: Parameters<typeof stringResource>[0] = {
      name: 'crew',
      loads,
      value: () => 'crew',
      watch: true,
      pending: unrelated.promise,
    }
    const crew = stringResource(crewOptions)
    const turn = rig({ resources: [skills, crew] })
    turn.events.push(
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-1:0:v1:${DIRECTORY}`,
        value: 'one',
      }),
      snapshotEventOf({
        resource: 'crew',
        fingerprint: `instance-1:0::${DIRECTORY}`,
        value: 'crew',
      }),
    )
    turn.daemon.seqs.set(WATCH_ID, 1)
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.Skills]: 'v2' })

    turn.sync.start()
    const started = Date.now()
    await turnStartOf(turn)
    const waited = Date.now() - started

    expect(waited).toBeLessThan(WAIT_MS)
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('two')
    expect(loadedFingerprintsOf(turn)).toEqual([
      `instance-1:0:v1:${DIRECTORY}`,
      `instance-1:0::${DIRECTORY}`,
      `instance-1:1:v2:${DIRECTORY}`,
    ])

    unrelated.open('crew')
    await turn.settled()
    expect(loads).toEqual(['skills', 'crew'])
  }, 10_000)

  it('starts from the old snapshot when the pod is not ready and reloads in the background', async () => {
    const loads: string[] = []
    const pod = gateOf()
    const skills = stringResource({
      name: 'skills',
      loads,
      value: () => 'two',
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const turn = rig({
      resources: [skills],
      podReady: false,
      beforeCall: async () => {
        await pod.promise
      },
    })
    turn.events.push(
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-1:0:v1:${DIRECTORY}`,
        value: 'one',
      }),
    )
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.Skills]: 'v2' })

    turn.sync.start()
    const started = Date.now()
    await turnStartOf(turn)
    const waited = Date.now() - started

    expect(waited).toBeLessThan(WAIT_MS)
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('one')

    turn.setPodReady(true)
    pod.open('')
    await turn.settled()

    expect(loadedFingerprintsOf(turn)).toEqual([
      `instance-1:0:v1:${DIRECTORY}`,
      `instance-1:0:v2:${DIRECTORY}`,
    ])
    expect(loads).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('two')
  }, 10_000)
  it('loads a changed unwatched resource before another resource has armed its watch', async () => {
    const loads: string[] = []
    const arming = gateOf()
    const instructions = stringResource({
      name: 'instructions',
      loads,
      value: () => 'v2',
      cloud: [ECloudSetting.PersonalInstructions],
    })
    const crew = stringResource({ name: 'crew', loads, value: () => 'crew', watch: true })
    const turn = rig({
      resources: [instructions, crew],
      beforeCall: async (op) => {
        if (op.op !== 'watch.start') return
        await arming.promise
      },
    })
    turn.events.push(
      snapshotEventOf({
        resource: 'instructions',
        fingerprint: `instance-1:unarmed:v1:${DIRECTORY}`,
        value: 'v1',
      }),
      snapshotEventOf({
        resource: 'crew',
        fingerprint: `instance-1:unarmed::${DIRECTORY}`,
        value: 'crew',
      }),
    )
    turn.daemon.setVersions({
      ...versionsAt('v1'),
      [ECloudSetting.PersonalInstructions]: 'v2',
    })

    turn.sync.start()
    const started = Date.now()
    await turnStartOf(turn)
    const waited = Date.now() - started

    expect(waited).toBeLessThan(WAIT_MS)
    expect(readResource({ ctx: turn.ctx, resource: instructions })).toBe('v2')
    expect(loads).toContain('instructions')

    arming.open('')
    await turn.settled()
  }, 10_000)
})
