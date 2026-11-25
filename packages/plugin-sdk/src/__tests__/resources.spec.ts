import { toEventId, toRunId, toThreadId, type Hash, type RecordEvent } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { composePod } from '../compose-pod'
import { ECloudSetting, EMPTY_POD_RESOURCES, readResource, type PodResource } from '../resources'
import { EMPTY_POD, type PluginPodContext, type PodSlot } from '../slots'

const HASH = 'a'.repeat(64) as Hash

let seq = 0

const loadedOf = (args: { resource: string; value: unknown }): RecordEvent => {
  seq += 1
  return {
    id: toEventId(`t:${seq}`),
    seq,
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    depth: 0,
    at: '2026-11-20T12:00:00.000Z',
    epoch: 1,
    prevHash: HASH,
    type: 'resource-loaded',
    resource: args.resource,
    fingerprint: `fingerprint-${seq}`,
    value: args.value,
  }
}

const resourceOf = <T>(args: {
  name: string
  schema: z.ZodType<T>
  value: T
  cloud?: readonly ECloudSetting[] | undefined
}): PodResource<T> => ({
  name: args.name,
  schema: args.schema,
  cloud: args.cloud,
  load: async () => args.value,
})

const skillsResource = (): PodResource<readonly string[]> =>
  resourceOf({
    name: 'skills',
    schema: z.array(z.string()),
    value: [],
    cloud: [ECloudSetting.Skills],
  })

const ctxWith = (events: readonly RecordEvent[]): Pick<PluginPodContext, 'events'> => ({
  events: () => events,
})

describe('readResource', () => {
  it('returns the latest recorded value for the resource', () => {
    const events = [
      loadedOf({ resource: 'skills', value: ['a'] }),
      loadedOf({ resource: 'skills', value: ['a', 'b'] }),
    ]
    expect(readResource({ ctx: ctxWith(events), resource: skillsResource() })).toEqual(['a', 'b'])
  })

  it('returns undefined when the resource was never recorded', () => {
    expect(readResource({ ctx: ctxWith([]), resource: skillsResource() })).toBeUndefined()
  })

  it('returns undefined when the recorded value fails the schema', () => {
    const events = [loadedOf({ resource: 'skills', value: { nope: true } })]
    expect(readResource({ ctx: ctxWith(events), resource: skillsResource() })).toBeUndefined()
  })
})

describe('pod resources', () => {
  it('reloads nothing when a pod declares none', async () => {
    await expect(EMPTY_POD_RESOURCES.reload('skills')).resolves.toBeUndefined()
  })

  it('composes every pod resource once by name', () => {
    const first: PodSlot = { ...EMPTY_POD, resources: [skillsResource()] }
    const second: PodSlot = {
      ...EMPTY_POD,
      resources: [resourceOf({ name: 'crew', schema: z.array(z.string()), value: [] })],
    }
    expect(composePod([first, second]).resources.map((resource) => resource.name)).toEqual([
      'skills',
      'crew',
    ])
  })

  it('refuses two resources with the same name', () => {
    const slot: PodSlot = { ...EMPTY_POD, resources: [skillsResource()] }
    expect(() => composePod([slot, slot])).toThrow('two plugins register the resource "skills"')
  })
})
