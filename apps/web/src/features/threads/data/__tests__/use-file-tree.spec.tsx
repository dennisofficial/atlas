import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { EClientRequest } from '@dltech/atlas-client/channel'

import { EFileTreeStatus, useFileTree, type FileTreeState } from '../use-file-tree'
import type { FileTreeChannel, TreeEntry } from '../file-tree-source'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const TREE: Record<string, TreeEntry[]> = {
  '': [{ name: 'src', isDirectory: true }],
  src: [{ name: 'a.ts', isDirectory: false }],
}

function channelOf() {
  const asked: string[] = []
  const channel: FileTreeChannel = {
    request: async ({ op, params }) => {
      if (op !== EClientRequest.BrowseDirectory) throw new Error('unexpected op')
      const directory = (params as { directory: string }).directory
      asked.push(directory)
      return { directory, entries: TREE[directory] ?? [] }
    },
  }
  return { channel, asked }
}

let mounts = 0

function mount(args: {
  channel: FileTreeChannel
  refreshKey: number
  latest: { current?: FileTreeState }
  threadId?: string
}) {
  const threadId = args.threadId ?? `tree-thread-${++mounts}`
  function Probe(props: { refreshKey: number }) {
    args.latest.current = useFileTree({
      channel: args.channel,
      refreshKey: props.refreshKey,
      threadId,
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  const render = (refreshKey: number) =>
    act(async () => root.render(<Probe refreshKey={refreshKey} />))
  return { render, unmount: () => act(async () => root.unmount()) }
}

describe('useFileTree', () => {
  it('lists only the root until a folder opens, then lists it once', async () => {
    const { channel, asked } = channelOf()
    const latest: { current?: FileTreeState } = {}
    const tree = mount({ channel, refreshKey: 0, latest })
    await tree.render(0)
    expect(latest.current?.view.status).toBe(EFileTreeStatus.Ready)
    expect(asked).toEqual([''])

    await act(async () => latest.current?.setOpen({ directory: 'src', open: true }))
    await act(async () => latest.current?.setOpen({ directory: 'src', open: false }))
    await act(async () => latest.current?.setOpen({ directory: 'src', open: true }))
    expect(asked).toEqual(['', 'src'])
    expect(latest.current?.open).toEqual(['src'])
    await tree.unmount()
  })

  it('re-lists the root and open folders on refresh', async () => {
    const { channel, asked } = channelOf()
    const latest: { current?: FileTreeState } = {}
    const tree = mount({ channel, refreshKey: 0, latest })
    await tree.render(0)
    await act(async () => latest.current?.setOpen({ directory: 'src', open: true }))
    await tree.render(1)
    expect(asked).toEqual(['', 'src', '', 'src'])
    await tree.unmount()
  })

  it('reopens and lists the folders left open when the same thread mounts again', async () => {
    const first = channelOf()
    const latest: { current?: FileTreeState } = {}
    const before = mount({ channel: first.channel, refreshKey: 0, latest, threadId: 'tree-kept' })
    await before.render(0)
    await act(async () => latest.current?.setOpen({ directory: 'src', open: true }))
    await before.unmount()

    const second = channelOf()
    const after = mount({ channel: second.channel, refreshKey: 0, latest, threadId: 'tree-kept' })
    await after.render(0)
    expect(latest.current?.open).toEqual(['src'])
    expect(second.asked).toEqual(['', 'src'])
    await after.unmount()
  })

  it('forgets a folder closed before leaving', async () => {
    const { channel } = channelOf()
    const latest: { current?: FileTreeState } = {}
    const before = mount({ channel, refreshKey: 0, latest, threadId: 'tree-closed' })
    await before.render(0)
    await act(async () => latest.current?.setOpen({ directory: 'src', open: true }))
    await act(async () => latest.current?.setOpen({ directory: 'src', open: false }))
    await before.unmount()

    const after = mount({ channel, refreshKey: 0, latest, threadId: 'tree-closed' })
    await after.render(0)
    expect(latest.current?.open).toEqual([])
    await after.unmount()
  })
})
