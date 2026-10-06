import { describe, expect, it } from 'bun:test'
import React, { act, useState } from 'react'
import { testRender } from '@opentui/react/test-utils'
import type { DirectoryEntry } from '@dltech/atlas-core'
import type { ContextFolderStateStore } from '@dltech/atlas-harness'

import { teardown } from '../../ui/markdown/__tests__/harness'
import type { ContextReaders } from '../session-binding'
import { EContextView, useContextBrowser, type ContextControl } from '../use-context'

type Held = { current: ContextControl | null }
type Source = { readers: ContextReaders; folderState?: ContextFolderStateStore | undefined }

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

function fixture() {
  const levels = new Map<string, readonly DirectoryEntry[]>([
    ['', [{ name: 'plan.md', isDirectory: false }, { name: 'notes', isDirectory: true }]],
    ['notes', [{ name: 'plan.md', isDirectory: false }, { name: 'deep', isDirectory: true }]],
    ['notes/deep', [{ name: 'decision.md', isDirectory: false }]],
  ])
  const listeners = new Set<() => void>()
  const asked: string[] = []
  let content = 'first'
  const readers: ContextReaders = {
    list: async (directory) => { asked.push(directory ?? ''); return levels.get(directory ?? '') ?? [] },
    load: async (path) => ({ type: 'text', content: `${path}: ${content}`, truncated: false }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { levels, readers, asked, listeners, update: (next: string) => { content = next },
    emit: () => { for (const listener of listeners) listener() } }
}

async function activate(args: { box: Held; path: string }) {
  await act(async () => { args.box.current?.handleOpen(args.path) })
  await settle()
}

describe('context browser with an inline tree', () => {
  it('loads root entries folders first', async () => {
    const { readers } = fixture()
    const { box, setup } = await probe({ readers })
    try {
      expect(box.current?.tree.loading).toBe(true)
      await settle()
      expect(box.current?.tree.loading).toBe(false)
      expect(pathsOf(box)).toEqual(['notes', 'notes/deep', 'notes/deep/decision.md', 'notes/plan.md', 'plan.md'])
    } finally { await teardown(setup) }
  })

  it('does not re-enter loading on a refresh once the tree has been read', async () => {
    const source = fixture()
    const { box, setup } = await probe({ readers: source.readers })
    try {
      await settle()
      await act(async () => { source.emit() })
      expect(box.current?.tree.loading).toBe(false)
      await settle()
      expect(box.current?.tree.loading).toBe(false)
    } finally { await teardown(setup) }
  })

  it('does not re-enter loading on a refresh even when the tree is empty', async () => {
    const source = fixture()
    source.levels.set('', [])
    const { box, setup } = await probe({ readers: source.readers })
    try {
      await settle()
      expect(box.current?.tree.loading).toBe(false)
      await act(async () => { source.emit() })
      expect(box.current?.tree.loading).toBe(false)
      await settle()
      expect(box.current?.tree.loading).toBe(false)
    } finally { await teardown(setup) }
  })

  it('preserves row identity for an unchanged refresh and unsubscribes on unmount', async () => {
    const source = fixture()
    const { box, setup } = await probe({ readers: source.readers })
    await settle()
    const first = box.current?.tree.rows
    await act(async () => { source.emit() })
    await settle()
    expect(box.current?.tree.rows).toBe(first)
    await act(async () => { await teardown(setup) })
    expect(source.listeners.size).toBe(0)
  })

  it('collapses and reopens folders on click while remembering nested choices', async () => {
    const source = fixture()
    const { box, setup } = await probe({ readers: source.readers })
    try {
      await settle()
      await activate({ box, path: 'notes/deep' })
      expect(pathsOf(box)).toEqual(['notes', 'notes/deep', 'notes/plan.md', 'plan.md'])
      expect(box.current?.viewer).toBeNull()
      await activate({ box, path: 'notes' })
      expect(pathsOf(box)).toEqual(['notes', 'plan.md'])
      expect(box.current?.tree.closed.has('notes/deep')).toBe(true)
      await activate({ box, path: 'notes' })
      expect(pathsOf(box)).toEqual(['notes', 'notes/deep', 'notes/plan.md', 'plan.md'])
      await activate({ box, path: 'notes/deep' })
      expect(pathsOf(box)).toContain('notes/deep/decision.md')
    } finally { await teardown(setup) }
  })

  it('opens the exact relative path when files share a basename', async () => {
    const { box, setup } = await probe({ readers: fixture().readers })
    try {
      await settle()
      await activate({ box, path: 'notes/plan.md' })
      expect(box.current?.viewer).toEqual({ state: EContextView.Ready, path: 'notes/plan.md',
        content: { type: 'text', content: 'notes/plan.md: first', truncated: false } })
      expect(box.current?.tree.opened).toBe('notes/plan.md')
      await act(async () => { box.current?.handleDismiss() })
      expect(box.current?.viewer).toBeNull()
    } finally { await teardown(setup) }
  })

  it('activating the opened file closes the viewer instead of reloading it', async () => {
    const source = fixture()
    const { box, setup } = await probe({ readers: source.readers })
    try {
      await settle()
      await activate({ box, path: 'plan.md' })
      expect(box.current?.viewer?.state).toBe(EContextView.Ready)
      source.update('reselected')
      await activate({ box, path: 'plan.md' })
      expect(box.current?.viewer).toBeNull()
      expect(box.current?.tree.opened).toBeNull()
    } finally { await teardown(setup) }
  })

  it('opens another file from the tree while one is already open', async () => {
    const source = fixture()
    const { box, setup } = await probe({ readers: source.readers })
    try {
      await settle()
      await activate({ box, path: 'plan.md' })
      await activate({ box, path: 'notes/plan.md' })
      expect(box.current?.viewer).toEqual({ state: EContextView.Ready, path: 'notes/plan.md',
        content: { type: 'text', content: 'notes/plan.md: first', truncated: false } })
    } finally { await teardown(setup) }
  })

  it('leaves keys to the viewer: escape closes it and tab or arrows never move a tree cursor', async () => {
    const { box, setup } = await probe({ readers: fixture().readers })
    try {
      await settle()
      await activate({ box, path: 'plan.md' })
      await act(async () => { box.current?.handleKey({ name: 'tab' }) })
      await act(async () => { box.current?.handleKey({ name: 'down' }) })
      expect(pathsOf(box)).toEqual(['notes', 'notes/deep', 'notes/deep/decision.md', 'notes/plan.md', 'plan.md'])
      expect(box.current?.viewer?.path).toBe('plan.md')
      await act(async () => { box.current?.handleKey({ name: 'escape' }) })
      expect(box.current?.viewer).toBeNull()
    } finally { await teardown(setup) }
  })

  it('refreshes expanded levels and the selected file without forgetting expansion', async () => {
    const source = fixture()
    const { box, setup } = await probe({ readers: source.readers })
    try {
      await settle()
      await activate({ box, path: 'notes/plan.md' })
      source.levels.set('notes', [{ name: 'plan.md', isDirectory: false }, { name: 'new.md', isDirectory: false }])
      source.update('updated')
      await act(async () => { source.emit() })
      await settle()
      expect(pathsOf(box)).toContain('notes/new.md')
      expect(box.current?.tree.closed.has('notes')).toBe(false)
      expect(box.current?.tree.opened).toBe('notes/plan.md')
      expect(box.current?.viewer).toEqual({ state: EContextView.Ready, path: 'notes/plan.md',
        content: { type: 'text', content: 'notes/plan.md: updated', truncated: false } })
    } finally { await teardown(setup) }
  })

  it('does not fetch closed descendants and drops removed directories after a refresh', async () => {
    const source = fixture()
    const { box, setup } = await probe({ readers: source.readers })
    try {
      await settle()
      expect(source.asked).toContain('notes/deep')
      await activate({ box, path: 'notes' })
      source.asked.length = 0
      await act(async () => { source.emit() })
      await settle()
      expect(source.asked).toEqual([''])
      source.levels.set('', [{ name: 'plan.md', isDirectory: false }])
      await act(async () => { source.emit() })
      await settle()
      expect(pathsOf(box)).toEqual(['plan.md'])
    } finally { await teardown(setup) }
  })

  it('navigates directly to a path that is unlisted or under a closed folder', async () => {
    const source = fixture()
    const { box, setup } = await probe({ readers: source.readers })
    try {
      await settle()
      await activate({ box, path: 'notes' })
      await act(async () => { box.current?.handleNavigate('notes/deep/decision.md') })
      await settle()
      expect(box.current?.viewer?.path).toBe('notes/deep/decision.md')
      expect(box.current?.viewer?.state).toBe(EContextView.Ready)
      await act(async () => { box.current?.handleNavigate('missing/ghost.md') })
      await settle()
      expect(box.current?.viewer?.path).toBe('missing/ghost.md')
      expect(box.current?.viewer?.state).toBe(EContextView.Ready)
    } finally { await teardown(setup) }
  })

  it('does not stay loading when navigating to the file already open', async () => {
    const { box, setup } = await probe({ readers: fixture().readers })
    try {
      await settle()
      await activate({ box, path: 'plan.md' })
      await act(async () => { box.current?.handleNavigate('plan.md') })
      await settle()
      expect(box.current?.viewer?.state).toBe(EContextView.Ready)
      expect(box.current?.viewer?.path).toBe('plan.md')
    } finally { await teardown(setup) }
  })
})
