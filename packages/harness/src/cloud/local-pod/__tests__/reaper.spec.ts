import { describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'

import type { ContainerSummary } from '../../../execution/docker/engine'
import { POD_ROLE, podHomeDigestOf, podHomeLabel, podNameFor, podRoleLabel, podThreadLabel } from '../pod-create'
import { reapOrphanPods } from '../reaper'

const HOME = '/home/atlas-test'

const summaryFor = (args: { threadId: string; name?: string }): ContainerSummary => ({
  id: `id-${args.threadId}`,
  name: `/${args.name ?? podNameFor({ threadId: args.threadId })}`,
  state: 'exited',
  labels: {
    [podThreadLabel]: args.threadId,
    [podRoleLabel]: POD_ROLE,
    [podHomeLabel]: podHomeDigestOf({ home: HOME }),
  },
})

type ListArgs = { labels: Record<string, string | undefined>; all?: boolean }

const harness = (args: {
  containers: ContainerSummary[]
  live?: string[]
  threadExists?: (args: { threadId: ThreadId }) => Promise<boolean>
  destroyPod?: (args: { name: string }) => Promise<void>
}) => {
  const listed: ListArgs[] = []
  const destroyed: string[] = []
  const logs: string[] = []
  const live = new Set(args.live ?? [])
  const run = () =>
    reapOrphanPods({
      engine: {
        listContainers: async (listArgs) => {
          listed.push(listArgs)
          return args.containers
        },
      },
      destroyPod:
        args.destroyPod ??
        (async ({ name }) => {
          destroyed.push(name)
        }),
      threadExists: args.threadExists ?? (async ({ threadId }) => live.has(threadId)),
      home: HOME,
      log: (line) => logs.push(line),
    })
  return { run, listed, destroyed, logs }
}

describe('reapOrphanPods', () => {
  it('lists every pod, running or not, by thread and role label', async () => {
    const { run, listed } = harness({ containers: [] })
    await run()
    expect(listed).toEqual([
      {
        labels: {
          [podThreadLabel]: undefined,
          [podRoleLabel]: POD_ROLE,
          [podHomeLabel]: podHomeDigestOf({ home: HOME }),
        },
        all: true,
      },
    ])
  })

  it('destroys an orphan under its derived name', async () => {
    const { run, destroyed } = harness({ containers: [summaryFor({ threadId: 'gone' })] })
    const sweep = await run()
    const name = podNameFor({ threadId: 'gone' })
    expect(destroyed).toEqual([name])
    expect(sweep).toEqual({ reaped: [name], kept: [], failures: [] })
  })

  it('leaves a pod whose thread still exists', async () => {
    const { run, destroyed } = harness({ containers: [summaryFor({ threadId: 'alive' })], live: ['alive'] })
    const sweep = await run()
    expect(destroyed).toEqual([])
    expect(sweep).toEqual({ reaped: [], kept: [podNameFor({ threadId: 'alive' })], failures: [] })
  })

  it('splits a mixed set into reaped and kept', async () => {
    const { run, destroyed } = harness({
      containers: [
        summaryFor({ threadId: 'a' }),
        summaryFor({ threadId: 'b' }),
        summaryFor({ threadId: 'c' }),
      ],
      live: ['b'],
    })
    const sweep = await run()
    expect(destroyed).toEqual([podNameFor({ threadId: 'a' }), podNameFor({ threadId: 'c' })])
    expect(sweep.reaped).toEqual(destroyed)
    expect(sweep.kept).toEqual([podNameFor({ threadId: 'b' })])
  })

  it('never destroys a container whose name was not derived from its thread label', async () => {
    const { run, destroyed } = harness({
      containers: [summaryFor({ threadId: 'gone', name: 'someone-elses-container' })],
    })
    const sweep = await run()
    expect(destroyed).toEqual([])
    expect(sweep).toEqual({ reaped: [], kept: ['someone-elses-container'], failures: [] })
  })

  it('never destroys a container with an empty thread label', async () => {
    const { run, destroyed } = harness({ containers: [summaryFor({ threadId: '', name: 'atlas-pod-empty' })] })
    const sweep = await run()
    expect(destroyed).toEqual([])
    expect(sweep.kept).toEqual(['atlas-pod-empty'])
  })

  it('keeps the pod when the thread check throws', async () => {
    const { run, destroyed, logs } = harness({
      containers: [summaryFor({ threadId: 'a' })],
      threadExists: async () => {
        throw new Error('store offline')
      },
    })
    const sweep = await run()
    expect(destroyed).toEqual([])
    expect(sweep).toEqual({ reaped: [], kept: [podNameFor({ threadId: 'a' })], failures: [] })
    expect(logs.join('\n')).toContain('store offline')
  })

  it('records a failed destroy and carries on with the next pod', async () => {
    const boom = new Error('volume busy')
    const destroyed: string[] = []
    const { run } = harness({
      containers: [summaryFor({ threadId: 'a' }), summaryFor({ threadId: 'b' })],
      destroyPod: async ({ name }) => {
        if (name === podNameFor({ threadId: 'a' })) throw boom
        destroyed.push(name)
      },
    })
    const sweep = await run()
    expect(sweep.failures).toEqual([{ name: podNameFor({ threadId: 'a' }), error: boom }])
    expect(sweep.reaped).toEqual([podNameFor({ threadId: 'b' })])
    expect(destroyed).toEqual([podNameFor({ threadId: 'b' })])
  })

  it('lets a listing failure propagate', async () => {
    const failure = new Error('daemon down')
    await expect(
      reapOrphanPods({
        engine: {
          listContainers: async () => {
            throw failure
          },
        },
        destroyPod: async () => undefined,
        threadExists: async () => false,
        home: HOME,
      }),
    ).rejects.toBe(failure)
  })
})
