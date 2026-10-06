import { describe, expect, it } from 'bun:test'
import React, { act, useState } from 'react'
import { testRender } from '@opentui/react/test-utils'
import type { DirectoryEntry } from '@dltech/atlas-core'
import type { ContextFolderStateStore } from '@dltech/atlas-harness'

import { teardown } from '../../ui/markdown/__tests__/harness'
import { currentNotices } from '../../ui/notice-store'
import type { ContextReaders } from '../session-binding'
import { useContextBrowser, type ContextControl } from '../use-context'

type Held = { current: ContextControl | null }
type Source = { readers: ContextReaders; folderState?: ContextFolderStateStore | undefined }

const levels = new Map<string, readonly DirectoryEntry[]>([
  ['', [{ name: 'plan.md', isDirectory: false }, { name: 'notes', isDirectory: true }]],
  ['notes', [{ name: 'deep', isDirectory: true }, { name: 'plan.md', isDirectory: false }]],
  ['notes/deep', [{ name: 'decision.md', isDirectory: false }]],
])
const asked: string[] = []
const readers: ContextReaders = {
  list: async (directory) => { asked.push(directory ?? ''); return levels.get(directory ?? '') ?? [] },
  load: async (path) => ({ type: 'text', content: path, truncated: false }),
  subscribe: () => () => {},
}

type Memory = ContextFolderStateStore & { saved: (readonly string[])[]; release: () => void }

function memoryStore(args: { initial?: readonly string[]; hold?: boolean; failLoad?: boolean; failSave?: boolean } = {}): Memory {
  let release: () => void = () => {}
  const gate = args.hold === true ? new Promise<void>((resolve) => { release = resolve }) : Promise.resolve()
  const saved: (readonly string[])[] = []
  return {
    saved, release: () => release(),
    load: async () => {
      await gate
      if (args.failLoad === true) throw new Error('disk unreadable')
      return args.initial ?? []
    },
    save: async (closed) => {
      saved.push(closed)
      if (args.failSave === true) throw new Error('disk full')
    },
  }
}

async function probe(first: Source) {
  const box: Held = { current: null }
  const swap: { current: (next: Source) => void } = { current: () => {} }
  const Probe = (): null => {
    const [source, setSource] = useState(first)
    swap.current = setSource
    box.current = useContextBrowser(source)
    return null
  }
  const setup = await testRender(<Probe />, { width: 20, height: 5 })
  return { box, setup, swap: async (next: Source) => { await act(async () => { swap.current(next) }) } }
}

const settle = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
const pathsOf = (box: Held) => box.current?.tree.rows.map((row) => row.path)
const activate = async (args: { box: Held; path: string }) => {
  await act(async () => { args.box.current?.handleOpen(args.path) })
  await settle()
}

describe('context folder state in the browser hook', () => {
  it('defaults to open and only saves when a folder is toggled', async () => {
    const store = memoryStore()
    const { box, setup } = await probe({ readers, folderState: store })
    try {
      await settle()
      expect(pathsOf(box)).toContain('notes/deep/decision.md')
      expect(store.saved).toEqual([])
      await activate({ box, path: 'notes/deep' })
      expect(store.saved).toEqual([['notes/deep']])
      await activate({ box, path: 'notes/deep' })
      expect(store.saved.at(-1)).toEqual([])
    } finally { await teardown(setup) }
  })

  it('restores closed folders after a remount and skips reading them', async () => {
    const store = memoryStore({ initial: ['notes/deep', 'vanished/old'] })
    asked.length = 0
    const { box, setup } = await probe({ readers, folderState: store })
    try {
      await settle()
      expect(pathsOf(box)).toEqual(['notes', 'notes/deep', 'notes/plan.md', 'plan.md'])
      expect(asked).not.toContain('notes/deep')
      expect(asked).not.toContain('vanished/old')
      expect(store.saved).toEqual([])
    } finally { await teardown(setup) }
  })

  it('waits for a slow load before walking the tree and ignores clicks meanwhile', async () => {
    const store = memoryStore({ initial: ['notes'], hold: true })
    asked.length = 0
    const { box, setup } = await probe({ readers, folderState: store })
    try {
      await settle()
      expect(asked).toEqual([])
      expect(box.current?.tree.loading).toBe(true)
      await act(async () => { box.current?.handleOpen('notes') })
      expect(store.saved).toEqual([])
      await act(async () => { store.release() })
      await settle()
      expect(box.current?.tree.loading).toBe(false)
      expect(pathsOf(box)).toEqual(['notes', 'plan.md'])
      expect(asked).not.toContain('notes')
    } finally { await teardown(setup) }
  })

  it('does not leak closed folders into a different session store', async () => {
    const first = memoryStore({ initial: ['notes'] })
    const second = memoryStore({ initial: [] })
    const { box, setup, swap } = await probe({ readers, folderState: first })
    try {
      await settle()
      expect(pathsOf(box)).toEqual(['notes', 'plan.md'])
      await swap({ readers, folderState: second })
      await settle()
      expect(pathsOf(box)).toContain('notes/deep/decision.md')
      await activate({ box, path: 'notes/deep' })
      expect(second.saved).toEqual([['notes/deep']])
      expect(first.saved).toEqual([])
    } finally { await teardown(setup) }
  })

  it('warns and falls back to all open when loading fails', async () => {
    const { box, setup } = await probe({ readers, folderState: memoryStore({ failLoad: true }) })
    try {
      await settle()
      expect(pathsOf(box)).toContain('notes/deep/decision.md')
      expect(currentNotices().some((notice) => notice.text.includes('disk unreadable'))).toBe(true)
    } finally { await teardown(setup) }
  })

  it('warns when saving fails but keeps the toggle in the tree', async () => {
    const { box, setup } = await probe({ readers, folderState: memoryStore({ failSave: true }) })
    try {
      await settle()
      await activate({ box, path: 'notes' })
      expect(pathsOf(box)).toEqual(['notes', 'plan.md'])
      expect(currentNotices().some((notice) => notice.text.includes('disk full'))).toBe(true)
    } finally { await teardown(setup) }
  })

  it('works without any store, staying open by default', async () => {
    const { box, setup } = await probe({ readers })
    try {
      await settle()
      await activate({ box, path: 'notes' })
      expect(pathsOf(box)).toEqual(['notes', 'plan.md'])
    } finally { await teardown(setup) }
  })
})
