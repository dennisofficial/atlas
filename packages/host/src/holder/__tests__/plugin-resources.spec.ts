import '@dltech/atlas-plugin-sdk/testing'

import { toEventId, toRunId, toThreadId, type V2Event } from '@dltech/atlas-core'
import {
  ECloudSetting,
  EMPTY_CREW,
  EMPTY_POD_RESOURCES,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  readResource,
  type PluginPodContext,
  type PodResource,
} from '@dltech/atlas-plugin-sdk'
import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { pluginResourcesHook, reloadResource } from '../plugin-resources'

const THREAD = toThreadId('t1')
const DIRECTORY = '/work'

type Rig = {
  ctx: PluginPodContext
  events: V2Event[]
  calls: CallOp[]
  loads: string[]
  logs: string[]
  seqs: Map<string, number>
  setInstance(instance: string): void
  setVersions(versions: Record<ECloudSetting, string>): void
  run(directory?: string): Promise<void>
}

const versionsAt = (version: string): Record<ECloudSetting, string> => ({
  [ECloudSetting.McpServers]: version,
  [ECloudSetting.Skills]: version,
  [ECloudSetting.PersonalInstructions]: version,
})

const rig = (args: { resources: readonly PodResource<unknown>[] }): Rig => {
  const events: V2Event[] = []
  const calls: CallOp[] = []
  const loads: string[] = []
  const logs: string[] = []
  const seqs = new Map<string, number>()
  let instance = 'instance-1'
  let versions = versionsAt('v1')

  const stamp = (draft: object, seq: number): V2Event =>
    ({
      ...draft,
      id: toEventId(`t:${seq}`),
      seq,
      threadId: THREAD,
      runId: toRunId('r'),
      depth: 0,
      at: '2026-11-20T12:00:00.000Z',
      epoch: 1,
      prevHash: 'a'.repeat(64),
    }) as V2Event

  const ctx: PluginPodContext = {
    sessionId: 'session-1',
    control: { ...podControlStub, settingsVersions: async () => versions },
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    resources: EMPTY_POD_RESOURCES,
    events: () => events,
    append: async (drafts) => {
      for (const draft of drafts) events.push(stamp(draft, events.length + 1))
    },
    notify: async () => undefined,
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: (message) => logs.push(message),
    call: async (op) => {
      calls.push(op)
      if (op.op === 'watch.status') {
        return {
          status: ECallStatus.Ok,
          op: 'watch.status',
          value: {
            instance,
            watches: op.watchIds.flatMap((watchId) => {
              const seq = seqs.get(watchId)
              return seq === undefined ? [] : [{ watchId, seq }]
            }),
          },
        } as CallResult
      }
      if (op.op === 'watch.start') {
        seqs.set(op.watchId, 0)
        return { status: ECallStatus.Ok, op: 'watch.start', value: [...op.roots] } as CallResult
      }
      return {
        status: ECallStatus.Failed,
        op: op.op,
        error: { code: ECallFailure.NotFound, message: `no ${op.op}` },
      } as CallResult
    },
  }

  const hook = pluginResourcesHook({ ctx, resources: args.resources })
  return {
    ctx,
    events,
    calls,
    loads,
    logs,
    seqs,
    setInstance: (next) => {
      instance = next
      seqs.clear()
    },
    setVersions: (next) => {
      versions = next
    },
    run: async (directory = DIRECTORY) => {
      await hook.run({ threadId: THREAD, projectDirectory: directory })
    },
  }
}

const stringResource = (args: {
  name: string
  loads: string[]
  value: () => string
  watch?: boolean
  cloud?: readonly ECloudSetting[] | undefined
  background?: boolean | undefined
  pending?: Promise<string> | undefined
  announce?: ((value: string) => readonly { type: 'probe-observed'; label: string }[]) | undefined
  stale?: ((value: string) => boolean) | undefined
}): PodResource<string> => ({
  name: args.name,
  schema: z.string(),
  ...(args.cloud === undefined ? {} : { cloud: args.cloud }),
  ...(args.background === undefined ? {} : { background: args.background }),
  ...(args.announce === undefined ? {} : { announce: args.announce }),
  ...(args.stale === undefined ? {} : { stale: args.stale }),
  ...(args.watch === true ? { watch: () => ({ roots: ['/work/.agents'] }) } : {}),
  load: async () => {
    args.loads.push(args.name)
    return await (args.pending ?? Promise.resolve(args.value()))
  },
})

const skillsOf = (loads: string[], overrides: Partial<Parameters<typeof stringResource>[0]> = {}) =>
  stringResource({ name: 'skills', loads, value: () => 'one', watch: true, ...overrides })

describe('the plugin-resources hook', () => {
  it('arms the watch, loads once, and leaves the snapshot readable', async () => {
    const loads: string[] = []
    const resource = skillsOf(loads)
    const turn = rig({ resources: [resource] })
    await turn.run()
    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource })).toBe('one')
  })

  it('asks only for watch status when nothing changed', async () => {
    const loads: string[] = []
    const turn = rig({ resources: [skillsOf(loads)] })
    await turn.run()
    turn.calls.length = 0
    await turn.run()
    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status'])
    expect(loads).toEqual(['skills'])
  })

  it('reloads when the watch seq moves', async () => {
    const loads: string[] = []
    let value = 'one'
    const resource = stringResource({ name: 'skills', loads, value: () => value, watch: true })
    const turn = rig({ resources: [resource] })
    await turn.run()
    expect(readResource({ ctx: turn.ctx, resource })).toBe('one')
    value = 'two'
    turn.seqs.set(`resource.skills.${THREAD}`, 1)
    await turn.run()
    expect(loads).toEqual(['skills', 'skills'])
    expect(readResource({ ctx: turn.ctx, resource })).toBe('two')
  })

  it('re-arms and reloads on a new daemon instance', async () => {
    const loads: string[] = []
    const turn = rig({ resources: [skillsOf(loads)] })
    await turn.run()
    turn.setInstance('instance-2')
    turn.calls.length = 0
    await turn.run()
    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills', 'skills'])
  })

  it('reloads only the cloud-dependent resources when a version moves', async () => {
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
    turn.setVersions(versionsAt('v2'))
    await turn.run()
    expect(loads).toEqual(['skills', 'crew', 'skills'])
  })

  it('re-arms and reloads when the project directory moves', async () => {
    const loads: string[] = []
    const turn = rig({ resources: [skillsOf(loads)] })
    await turn.run()
    turn.calls.length = 0
    await turn.run('/elsewhere')
    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills', 'skills'])
  })

  it('records nothing when the load fails', async () => {
    const resource: PodResource<string> = {
      name: 'skills',
      schema: z.string(),
      watch: () => ({ roots: ['/work/.agents'] }),
      load: async () => {
        throw new Error('the pod is gone')
      },
    }
    const turn = rig({ resources: [resource] })
    await turn.run()
    expect(turn.events).toHaveLength(0)
    expect(turn.logs.join(' ')).toContain('could not load')
  })

  it('reloads when the resource reports its own value stale', async () => {
    const loads: string[] = []
    let stale = false
    const resource = skillsOf(loads, { stale: () => stale })
    const turn = rig({ resources: [resource] })
    await turn.run()
    stale = true
    await turn.run()
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

  it('announces on an explicit reload and forces the next turn to refresh', async () => {
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
    expect(turn.calls.map((call) => call.op)).toEqual(['watch.status', 'watch.start'])
    expect(loads).toEqual(['skills', 'skills', 'skills'])
  })
})
