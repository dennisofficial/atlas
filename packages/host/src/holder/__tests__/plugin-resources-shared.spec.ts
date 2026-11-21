import { ECloudSetting, readResource, type PodResource } from '@dltech/atlas-plugin-sdk'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { watchIdOf } from '../plugin-resource-probes'
import {
  DIRECTORY,
  agentsRootOf,
  rig,
  skillsOf,
  snapshotEventOf,
  stringResource,
  versionsAt,
} from './plugin-resources-rig'

const announceOf = (value: string): readonly { type: 'probe-observed'; label: string }[] => [
  { type: 'probe-observed', label: value },
]

const watchIdAt = (directory: string): string => watchIdOf({ roots: [agentsRootOf(directory)] })

describe('a sub-agent sharing the main thread snapshots', () => {
  it('adopts the main thread snapshot without loading or arming', async () => {
    const mainLoads: string[] = []
    const main = rig({ resources: [skillsOf(mainLoads, { announce: announceOf })] })
    await main.run()
    expect(mainLoads).toEqual(['skills'])

    const childLoads: string[] = []
    const resource = skillsOf(childLoads, { announce: announceOf })
    const child = rig({
      resources: [resource],
      daemon: main.daemon,
      shared: () => main.events,
    })
    await child.run()

    expect(child.calls.map((call) => call.op)).toEqual(['watch.status'])
    expect(childLoads).toEqual([])
    expect(child.events.map((event) => event.type)).toEqual(['resource-loaded', 'probe-observed'])
    const [adopted] = child.events
    expect(adopted?.type === 'resource-loaded' ? adopted.fingerprint : undefined).toBe(
      `instance-1:0::${DIRECTORY}`,
    )
    expect(readResource({ ctx: child.ctx, resource })).toBe('one')
  })

  it('loads its own snapshot when the main thread worked in another directory', async () => {
    const main = rig({ resources: [skillsOf([])] })
    await main.run()

    const childLoads: string[] = []
    const child = rig({
      resources: [skillsOf(childLoads)],
      daemon: main.daemon,
      shared: () => main.events,
    })
    await child.run('/elsewhere')

    expect(child.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(childLoads).toEqual(['skills'])
  })

  it('loads its own snapshot when the shared watch seq moved', async () => {
    const main = rig({ resources: [skillsOf([])] })
    await main.run()
    main.daemon.seqs.set(watchIdAt(DIRECTORY), 1)

    const childLoads: string[] = []
    const child = rig({
      resources: [skillsOf(childLoads)],
      daemon: main.daemon,
      shared: () => main.events,
    })
    await child.run()

    expect(child.calls.map((call) => call.op)).toEqual(['watch.status'])
    expect(childLoads).toEqual(['skills'])
  })

  it('loads its own snapshot when the shared cloud version moved', async () => {
    const main = rig({ resources: [skillsOf([], { cloud: [ECloudSetting.Skills] })] })
    await main.run()
    main.daemon.setVersions(versionsAt('v2'))

    const childLoads: string[] = []
    const child = rig({
      resources: [skillsOf(childLoads, { cloud: [ECloudSetting.Skills] })],
      daemon: main.daemon,
      shared: () => main.events,
    })
    await child.run()

    expect(childLoads).toEqual(['skills'])
  })

  it('loads its own snapshot when the resource calls the shared value stale', async () => {
    const main = rig({ resources: [skillsOf([])] })
    await main.run()

    const childLoads: string[] = []
    const child = rig({
      resources: [skillsOf(childLoads, { stale: () => true })],
      daemon: main.daemon,
      shared: () => main.events,
    })
    await child.run()

    expect(childLoads).toEqual(['skills'])
  })

  it('loads its own snapshot when the shared value fails its schema', async () => {
    const main = rig({ resources: [skillsOf([])] })
    await main.run()

    const childLoads: string[] = []
    const child = rig({
      resources: [skillsOf(childLoads)],
      daemon: main.daemon,
      shared: () => [
        snapshotEventOf({
          resource: 'skills',
          fingerprint: `instance-1:0::${DIRECTORY}`,
          value: 5,
        }),
      ],
    })
    await child.run()

    expect(childLoads).toEqual(['skills'])
  })
})

describe('watches shared between resources', () => {
  it('arms one watch for two resources with the same spec', async () => {
    const loads: string[] = []
    const skills = skillsOf(loads)
    const crew: PodResource<string> = stringResource({
      name: 'crew',
      loads,
      value: () => 'crew',
      watch: true,
    })
    const turn = rig({ resources: [skills, crew] })
    await turn.run()

    const [status] = turn.calls
    expect(status?.op === 'watch.status' ? status.watchIds : []).toEqual([watchIdAt(DIRECTORY)])
    const armed = turn.calls.filter((call) => call.op === 'watch.start')
    expect(armed).toHaveLength(1)
    expect(armed[0]?.op === 'watch.start' ? armed[0].watchId : undefined).toBe(watchIdAt(DIRECTORY))
    expect(loads).toEqual(['skills', 'crew'])
  })

  it('retries a failed load on the next turn without arming again', async () => {
    let attempts = 0
    const resource: PodResource<string> = {
      name: 'skills',
      schema: z.string(),
      watch: (directory) => ({ roots: [agentsRootOf(directory)] }),
      load: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('the pod is gone')
        return 'one'
      },
    }
    const turn = rig({ resources: [resource] })
    await turn.run()
    turn.calls.length = 0
    await turn.run()

    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status'])
    expect(attempts).toBe(2)
    expect(readResource({ ctx: turn.ctx, resource })).toBe('one')
  })
})

describe('the plugin-resources spans', () => {
  it('times the status, versions, arm, load and append steps', async () => {
    const trace = new RecordingTracer()
    const turn = rig({ resources: [skillsOf([])], trace })
    await trace.span({ name: ESpan.TurnHooks, root: true, run: () => turn.run() })

    expect(trace.named(ESpan.ResourceStatus)).toHaveLength(1)
    expect(trace.named(ESpan.ResourceVersions)).toHaveLength(1)
    expect(trace.named(ESpan.ResourceArm).map((span) => span.fields)).toEqual([
      { resource: 'skills' },
    ])
    expect(trace.named(ESpan.ResourceLoad).map((span) => span.fields)).toEqual([
      { resource: 'skills' },
    ])
    expect(trace.named(ESpan.ResourceAppend).map((span) => span.fields)).toEqual([{ drafts: 1 }])
  })
})
