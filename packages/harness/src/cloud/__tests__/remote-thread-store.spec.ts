import { describe, expect, it } from 'bun:test'
import { ECompactionAnchor, EExecutionLocation, EForkMode, toThreadId } from '@dltech/atlas-core'

import { EClientRequest } from '../channel-wire'
import type { RemoteDeltaChannel } from '../remote-delta-channel'
import { RemoteThreadStore } from '../remote-thread-store'

type Call = { op: EClientRequest; params: unknown }

const wireThread = {
  id: 'brn_1',
  head: 3,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:01:00.000Z',
  workspace: '/repo',
  repo: '/repo',
  title: 'a thread',
  forkMode: 'reference',
  parent: { threadId: 'brn_parent', forkSeq: 2 },
  agent: { spawnedBy: 'brn_root', type: 'explore' },
  model: { ref: 'anthropic/claude-opus', effort: 'high' },
}

const harness = (replies: Record<string, unknown>) => {
  const calls: Call[] = []
  const channel: Pick<RemoteDeltaChannel, 'request'> = {
    request: async (args: { op: EClientRequest; params: unknown }) => {
      calls.push({ op: args.op, params: args.params })
      return replies[args.op] ?? {}
    },
  }
  return { store: new RemoteThreadStore({ channel }), calls }
}

describe('RemoteThreadStore', () => {
  it('find reads one thread over the channel and maps it', async () => {
    const { store, calls } = harness({ [EClientRequest.ReadThread]: { thread: wireThread } })

    const thread = await store.find({ threadId: toThreadId('brn_1') })

    expect(calls[0]?.op).toBe(EClientRequest.ReadThread)
    expect(calls[0]?.params).toEqual({ threadId: toThreadId('brn_1') })
    expect(thread).toMatchObject({
      id: 'brn_1',
      head: 3,
      title: 'a thread',
      parent: { threadId: 'brn_parent', forkSeq: 2 },
      forkMode: EForkMode.Reference,
      model: { ref: 'anthropic/claude-opus', effort: 'high' },
    })
  })

  it('find answers undefined when the sandbox has no such thread', async () => {
    const { store } = harness({ [EClientRequest.ReadThread]: { thread: null } })

    expect(await store.find({ threadId: toThreadId('brn_nope') })).toBeUndefined()
  })

  it('spawned keeps only the threads the named one supervises', async () => {
    const { store, calls } = harness({
      [EClientRequest.ReadThreads]: {
        threads: [
          wireThread,
          { ...wireThread, id: 'brn_other', agent: { spawnedBy: 'brn_elsewhere', type: 'build' } },
          { ...wireThread, id: 'brn_root', agent: undefined },
        ],
      },
    })

    const children = await store.spawned({ threadId: toThreadId('brn_root') })

    expect(calls[0]?.op).toBe(EClientRequest.ReadThreads)
    expect(children.map((child) => child.id)).toEqual([toThreadId('brn_1')])
  })

  it('findNamed matches a title over the channel thread list', async () => {
    const { store } = harness({ [EClientRequest.ReadThreads]: { threads: [wireThread] } })

    const found = await store.findNamed({ project: '/repo', handle: 'a thread' })

    expect(found?.id).toBe(toThreadId('brn_1'))
  })

  it('every write refuses — the sandbox owns the transcript while lifted', async () => {
    const { store, calls } = harness({})
    const threadId = toThreadId('brn_1')

    await expect(store.create({ title: 'x' })).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.createWithFirstEvents({ runId: 'run_1' as never, drafts: [] }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(store.rename({ threadId, title: 'x' })).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.chooseModel({ threadId, model: { ref: 'r', effort: 'e' } }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.chooseExecutionLocation({ threadId, location: EExecutionLocation.Docker }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(store.adopt({ threadId, workspace: '/w', repo: null })).rejects.toThrow(
      'the sandbox owns the transcript',
    )
    await expect(store.rewind({ threadId, toSeq: 2 })).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.compact({
        threadId,
        anchor: ECompactionAnchor.Prefix,
        fromSeq: 1,
        throughSeq: 2,
        summary: 's',
      }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.summarise({
        threadId,
        anchor: ECompactionAnchor.Suffix,
        fromSeq: 1,
        throughSeq: 2,
        summary: 's',
      }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.fork({ from: threadId, seq: 1, mode: EForkMode.Copy }),
    ).rejects.toThrow('the sandbox owns the transcript')
    expect(calls).toHaveLength(0)
  })

  it('onRename subscribes and unsubscribes without notifying — renames refuse before they land', () => {
    const { store } = harness({})
    const heard: unknown[] = []

    const forget = store.onRename((renamed) => heard.push(renamed))
    forget()

    expect(heard).toEqual([])
  })
})
