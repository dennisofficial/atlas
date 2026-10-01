import { describe, expect, it } from 'bun:test'
import { ECompactionAnchor, EExecutionLocation, EForkMode, toThreadId } from '@dltech/atlas-core'

import { EClientRequest } from '../channel-wire'
import type { RemoteDeltaChannel } from '../remote-delta-channel'
import { RemoteThreadStore } from '../remote-thread-store'

type Call = { op: EClientRequest; params: unknown }

const THREAD = toThreadId('brn_1')

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

type RenamedListener = Parameters<RemoteDeltaChannel['onThreadRenamed']>[0]
type ModelChangedListener = Parameters<RemoteDeltaChannel['onThreadModelChanged']>[0]

const harness = (replies: Record<string, unknown>) => {
  const calls: Call[] = []
  const pushes: { renamed: RenamedListener | undefined; modelChanged: ModelChangedListener | undefined } = {
    renamed: undefined,
    modelChanged: undefined,
  }
  const channel: Pick<
    RemoteDeltaChannel,
    'request' | 'onThreadRenamed' | 'onThreadModelChanged'
  > = {
    request: async (args: { op: EClientRequest; params: unknown }) => {
      calls.push({ op: args.op, params: args.params })
      const reply = replies[args.op]
      if (reply instanceof Error) throw reply
      return reply ?? {}
    },
    onThreadRenamed: (listener) => {
      pushes.renamed = listener
      return () => undefined
    },
    onThreadModelChanged: (listener) => {
      pushes.modelChanged = listener
      return () => undefined
    },
  }
  return { store: new RemoteThreadStore({ channel }), calls, pushes }
}

describe('RemoteThreadStore', () => {
  it('find reads one thread over the channel and maps it', async () => {
    const { store, calls } = harness({ [EClientRequest.ReadThread]: { thread: wireThread } })

    const thread = await store.find({ threadId: THREAD })

    expect(calls[0]?.op).toBe(EClientRequest.ReadThread)
    expect(calls[0]?.params).toEqual({ threadId: THREAD })
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

    expect(found?.id).toBe(THREAD)
  })

  it('rename sends the rename-thread op and fires its own listeners on the reply', async () => {
    const { store, calls } = harness({ [EClientRequest.RenameThread]: {} })
    const heard: { threadId: string; title: string }[] = []
    store.onRename((renamed) => void heard.push(renamed))

    await store.rename({ threadId: THREAD, title: 'a better name' })

    expect(calls).toEqual([
      { op: EClientRequest.RenameThread, params: { threadId: THREAD, title: 'a better name' } },
    ])
    expect(heard).toEqual([{ threadId: THREAD, title: 'a better name' }])
  })

  it('rename does not fire its listeners when the sandbox refuses the op', async () => {
    const { store } = harness({
      [EClientRequest.RenameThread]: new Error('the sandbox refused the rename-thread request'),
    })
    const heard: unknown[] = []
    store.onRename((renamed) => void heard.push(renamed))

    await expect(store.rename({ threadId: THREAD, title: 'x' })).rejects.toThrow(
      'refused the rename-thread request',
    )
    expect(heard).toEqual([])
  })

  it('chooseModel sends the set-thread-model op with the full pair and fires on the reply', async () => {
    const { store, calls } = harness({ [EClientRequest.SetThreadModel]: {} })
    const heard: { threadId: string; model: { ref: string; effort: string } }[] = []
    store.onModelChosen((chosen) => void heard.push(chosen))

    await store.chooseModel({
      threadId: THREAD,
      model: { ref: 'anthropic/claude-opus-5', effort: 'high' },
    })

    expect(calls).toEqual([
      {
        op: EClientRequest.SetThreadModel,
        params: { threadId: THREAD, model: { ref: 'anthropic/claude-opus-5', effort: 'high' } },
      },
    ])
    expect(heard).toEqual([
      { threadId: THREAD, model: { ref: 'anthropic/claude-opus-5', effort: 'high' } },
    ])
  })

  it('chooseModel forwards retarget true and false and still fires once on the reply', async () => {
    const { store, calls } = harness({ [EClientRequest.SetThreadModel]: {} })
    const heard: unknown[] = []
    store.onModelChosen((chosen) => void heard.push(chosen))
    const model = { ref: 'anthropic/claude-opus-5', effort: 'high' }

    await store.chooseModel({ threadId: THREAD, model, retarget: true })
    await store.chooseModel({ threadId: THREAD, model, retarget: false })

    expect(calls.map((call) => call.params)).toEqual([
      { threadId: THREAD, model, retarget: true },
      { threadId: THREAD, model, retarget: false },
    ])
    expect(heard).toEqual([
      { threadId: THREAD, model },
      { threadId: THREAD, model },
    ])
  })

  it('chooseModel leaves retarget off the wire when it is omitted or undefined', async () => {
    const { store, calls } = harness({ [EClientRequest.SetThreadModel]: {} })
    const model = { ref: 'r', effort: 'e' }

    await store.chooseModel({ threadId: THREAD, model })
    await store.chooseModel({ threadId: THREAD, model, retarget: undefined })

    for (const call of calls) expect('retarget' in (call.params as object)).toBe(false)
  })

  it('chooseModel does not fire its listeners when a retargeting request is refused', async () => {
    const { store } = harness({
      [EClientRequest.SetThreadModel]: new Error('the sandbox refused the set-thread-model request'),
    })
    const heard: unknown[] = []
    store.onModelChosen((chosen) => void heard.push(chosen))

    await expect(
      store.chooseModel({ threadId: THREAD, model: { ref: 'r', effort: 'e' }, retarget: true }),
    ).rejects.toThrow('refused the set-thread-model request')
    expect(heard).toEqual([])
  })

  it('chooseModel does not fire its listeners when the sandbox refuses the op', async () => {
    const { store } = harness({
      [EClientRequest.SetThreadModel]: new Error('the sandbox refused the set-thread-model request'),
    })
    const heard: unknown[] = []
    store.onModelChosen((chosen) => void heard.push(chosen))

    await expect(
      store.chooseModel({ threadId: THREAD, model: { ref: 'r', effort: 'e' } }),
    ).rejects.toThrow('refused the set-thread-model request')
    expect(heard).toEqual([])
  })

  it('a thread-renamed push frame fires the rename listeners', () => {
    const { store, pushes } = harness({})
    const heard: { threadId: string; title: string }[] = []
    store.onRename((renamed) => void heard.push(renamed))

    pushes.renamed?.({ threadId: THREAD, title: 'titled in the sandbox' })

    expect(heard).toEqual([{ threadId: THREAD, title: 'titled in the sandbox' }])
  })

  it('a thread-model-changed push frame fires the model listeners', () => {
    const { store, pushes } = harness({})
    const heard: { threadId: string; model: { ref: string; effort: string } }[] = []
    store.onModelChosen((chosen) => void heard.push(chosen))

    pushes.modelChanged?.({
      threadId: THREAD,
      model: { ref: 'openai/gpt-5.2-codex', effort: 'medium' },
    })

    expect(heard).toEqual([
      { threadId: THREAD, model: { ref: 'openai/gpt-5.2-codex', effort: 'medium' } },
    ])
  })

  it('an unsubscribed listener hears nothing further', async () => {
    const { store, pushes } = harness({ [EClientRequest.RenameThread]: {} })
    const heard: unknown[] = []
    const forget = store.onRename((renamed) => void heard.push(renamed))
    forget()

    pushes.renamed?.({ threadId: THREAD, title: 'ignored' })
    await store.rename({ threadId: THREAD, title: 'also ignored' })

    expect(heard).toEqual([])
  })

  it('the mutations the sandbox owns still refuse', async () => {
    const { store, calls } = harness({})

    await expect(store.create({ title: 'x' })).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.createWithFirstEvents({ runId: 'run_1' as never, drafts: [] }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.chooseExecutionLocation({ threadId: THREAD, location: EExecutionLocation.Docker }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(store.adopt({ threadId: THREAD, workspace: '/w', repo: null })).rejects.toThrow(
      'the sandbox owns the transcript',
    )
    await expect(store.rewind({ threadId: THREAD, toSeq: 2 })).rejects.toThrow(
      'the sandbox owns the transcript',
    )
    await expect(
      store.compact({
        threadId: THREAD,
        anchor: ECompactionAnchor.Prefix,
        fromSeq: 1,
        throughSeq: 2,
        summary: 's',
      }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(
      store.summarise({
        threadId: THREAD,
        anchor: ECompactionAnchor.Suffix,
        fromSeq: 1,
        throughSeq: 2,
        summary: 's',
      }),
    ).rejects.toThrow('the sandbox owns the transcript')
    await expect(store.fork({ from: THREAD, seq: 1, mode: EForkMode.Copy })).rejects.toThrow(
      'the sandbox owns the transcript',
    )
    expect(calls).toHaveLength(0)
  })
})
