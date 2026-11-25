import { ECloudSetting, readResource, type PodResource } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { watchIdOf } from '../plugin-resource-probes'
import { reloadResource } from '../plugin-resources'
import {
  DIRECTORY,
  agentsRootOf,
  rig,
  skillsOf,
  stringResource,
  versionsAt,
} from './plugin-resources-rig'

const watchIdAt = (directory: string): string => watchIdOf({ roots: [agentsRootOf(directory)] })

describe('the plugin resources load at startup and on a push', () => {
  it('arms the watch, loads once, and leaves the snapshot readable', async () => {
    const loads: string[] = []
    const resource = skillsOf(loads)
    const turn = rig({ resources: [resource] })
    await turn.run()
    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource })).toBe('one')
  })

  it('makes no pod and no control call when a later turn starts unchanged', async () => {
    const loads: string[] = []
    const resource = skillsOf(loads, { cloud: [ECloudSetting.Skills] })
    const turn = rig({ resources: [resource] })
    await turn.run()
    turn.calls.length = 0
    await turn.run()
    expect(turn.calls).toEqual([])
    expect(loads).toEqual(['skills'])
  })

  it('reloads only the resource its own watch reports changed', async () => {
    const loads: string[] = []
    const skills = skillsOf(loads)
    const crew = stringResource({ name: 'crew', loads, value: () => 'crew' })
    const turn = rig({ resources: [skills, crew] })
    await turn.run()
    turn.calls.length = 0

    turn.changed(watchIdAt(DIRECTORY))
    await turn.settled()

    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status'])
    expect(loads.filter((name) => name === 'crew')).toHaveLength(1)
    expect(loads.filter((name) => name === 'skills')).toHaveLength(2)
    expect(readResource({ ctx: turn.ctx, resource: crew })).toBe('crew')
  })

  it('ignores a change reported for a watch it does not own', async () => {
    const loads: string[] = []
    const turn = rig({ resources: [skillsOf(loads)] })
    await turn.run()
    turn.calls.length = 0

    turn.changed('resource.someone-else')
    await turn.settled()

    expect(turn.calls).toEqual([])
    expect(loads).toEqual(['skills'])
  })

  it('re-arms and reloads when the daemon instance changed', async () => {
    const loads: string[] = []
    const turn = rig({ resources: [skillsOf(loads)] })
    await turn.run()
    turn.daemon.setInstance('instance-2')
    turn.calls.length = 0

    turn.reconnect(true)
    await turn.settled()

    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills', 'skills'])
  })

  it('does nothing when the link comes back without a restart', async () => {
    const loads: string[] = []
    const turn = rig({ resources: [skillsOf(loads)] })
    await turn.run()
    turn.calls.length = 0

    turn.reconnect(false)
    await turn.settled()

    expect(turn.calls).toEqual([])
    expect(loads).toEqual(['skills'])
  })

  it('reloads only the cloud-dependent resources when a version moved, after the turn ends', async () => {
    const loads: string[] = []
    const cloud = stringResource({
      name: 'skills',
      loads,
      value: () => 'one',
      cloud: [ECloudSetting.Skills],
    })
    const local = stringResource({ name: 'crew', loads, value: () => 'crew' })
    const turn = rig({ resources: [cloud, local] })
    await turn.run()
    expect(loads).toEqual(['skills', 'crew'])
    turn.daemon.setVersions(versionsAt('v2'))
    await turn.closed()
    expect(loads).toEqual(['skills', 'crew', 'skills'])
  })

  it('re-arms and reloads after the turn that moved the project directory', async () => {
    const loads: string[] = []
    const turn = rig({ resources: [skillsOf(loads)] })
    await turn.run()
    turn.calls.length = 0

    await turn.run('/elsewhere')
    expect(turn.calls).toEqual([])

    await turn.closed()
    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills', 'skills'])
  })

  it('records nothing when the load fails', async () => {
    const resource: PodResource<string> = {
      name: 'skills',
      schema: z.string(),
      watch: (directory) => ({ roots: [agentsRootOf(directory)] }),
      load: async () => {
        throw new Error('the pod is gone')
      },
    }
    const turn = rig({ resources: [resource] })
    await turn.run()
    expect(turn.events).toHaveLength(0)
    expect(turn.logs.join(' ')).toContain('could not load')
  })

  it('reloads a resource that reports its own value stale, after the turn ends', async () => {
    const loads: string[] = []
    let stale = false
    const resource = skillsOf(loads, { stale: () => stale })
    const turn = rig({ resources: [resource] })
    await turn.run()
    stale = true
    await turn.run()
    expect(loads).toEqual(['skills'])
    await turn.closed()
    expect(loads).toEqual(['skills', 'skills'])
  })

  it('appends a background snapshot later without holding the turn', async () => {
    const loads: string[] = []
    let later: (value: string) => void = () => undefined
    const pending = new Promise<string>((resolve) => {
      later = resolve
    })
    const resource = skillsOf(loads, { background: true, pending })
    const turn = rig({ resources: [resource] })
    await turn.run()
    expect(turn.events).toHaveLength(0)
    later('late')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readResource({ ctx: turn.ctx, resource })).toBe('late')
  })

  it('appends the resource announcement with the snapshot', async () => {
    const loads: string[] = []
    const resource = skillsOf(loads, {
      announce: (value) => [{ type: 'probe-observed', label: value }],
    })
    const turn = rig({ resources: [resource] })
    await turn.run()
    expect(turn.events.map((event) => event.type)).toEqual(['resource-loaded', 'probe-observed'])
  })

  it('announces on an explicit reload and leaves the next turn unblocked', async () => {
    const loads: string[] = []
    const resource = skillsOf(loads, {
      announce: (value) => [{ type: 'probe-observed', label: value }],
    })
    const turn = rig({ resources: [resource] })
    await turn.run()
    await reloadResource({ ctx: turn.ctx, resource, directory: DIRECTORY })
    expect(turn.events.map((event) => event.type)).toEqual([
      'resource-loaded',
      'probe-observed',
      'resource-loaded',
      'probe-observed',
    ])
    turn.calls.length = 0
    await turn.run()
    expect(turn.calls).toEqual([])
    expect(loads).toEqual(['skills', 'skills'])
  })
})
