import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import type { DirectoryEntry } from '@dltech/atlas-core'

import { teardown } from '../../ui/markdown/__tests__/harness'
import type { ContextReaders } from '../session-binding'
import { EContextView, useContextBrowser, type ContextControl } from '../use-context'

type Held = { current: ContextControl | null }

async function probe(readers: ContextReaders) {
  const box: Held = { current: null }
  const Probe = (): null => { box.current = useContextBrowser({ readers }); return null }
  const setup = await testRender(<Probe />, { width: 20, height: 5 })
  return { box, setup }
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

async function key(args: { box: Held; name: string }) {
  await act(async () => { args.box.current?.handleKey({ name: args.name }) })
  await settle()
}

describe('context browser with an inline tree', () => {
  it('loads root entries folders first', async () => {
    const { readers } = fixture()
    const { box, setup } = await probe(readers)
    try {
      expect(box.current?.tree.loading).toBe(true)
      await settle()
      expect(box.current?.tree.loading).toBe(false)
      expect(pathsOf(box)).toEqual(['notes', 'plan.md'])
    } finally { await teardown(setup) }
  })

  it('does not re-enter loading on a refresh once the tree has been read', async () => {
    const source = fixture()
    const { box, setup } = await probe(source.readers)
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
    const { box, setup } = await probe(source.readers)
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
    const { box, setup } = await probe(source.readers)
    await settle()
    const first = box.current?.tree.rows
    await act(async () => { source.emit() })
    await settle()
    expect(box.current?.tree.rows).toBe(first)
    await act(async () => { await teardown(setup) })
    expect(source.listeners.size).toBe(0)
  })

  it('expands and collapses folders inline without losing root siblings or nested expansion', async () => {
    const source = fixture()
    const { box, setup } = await probe(source.readers)
    try {
      await settle()
      await activate({ box, path: 'notes' })
      expect(pathsOf(box)).toEqual(['notes', 'notes/deep', 'notes/plan.md', 'plan.md'])
      expect(box.current?.viewer).toBeNull()
      await activate({ box, path: 'notes/deep' })
      expect(pathsOf(box)).toContain('notes/deep/decision.md')
      await activate({ box, path: 'notes' })
      expect(pathsOf(box)).toEqual(['notes', 'plan.md'])
      expect(box.current?.tree.expanded.has('notes/deep')).toBe(true)
      await activate({ box, path: 'notes' })
      expect(pathsOf(box)).toContain('notes/deep/decision.md')
    } finally { await teardown(setup) }
  })

  it('opens the exact relative path when files share a basename', async () => {
    const { box, setup } = await probe(fixture().readers)
    try {
      await settle()
      await activate({ box, path: 'notes' })
      await activate({ box, path: 'notes/plan.md' })
      expect(box.current?.viewer).toEqual({ state: EContextView.Ready, path: 'notes/plan.md',
        content: { type: 'text', content: 'notes/plan.md: first', truncated: false } })
      expect(box.current?.tree.opened).toBe('notes/plan.md')
      expect(box.current?.tree.focused).toBe(false)
      await act(async () => { box.current?.handleDismiss() })
      expect(box.current?.viewer).toBeNull()
    } finally { await teardown(setup) }
  })

  it('can select the same file repeatedly without getting stuck in a loading view', async () => {
    const source = fixture()
    const { box, setup } = await probe(source.readers)
    try {
      await settle()
      await activate({ box, path: 'plan.md' })
      source.update('reselected')
      await activate({ box, path: 'plan.md' })
      expect(box.current?.viewer).toEqual({ state: EContextView.Ready, path: 'plan.md',
        content: { type: 'text', content: 'plan.md: reselected', truncated: false } })
    } finally { await teardown(setup) }
  })

  it('uses arrows for tree navigation only while the tree owns focus', async () => {
    const { box, setup } = await probe(fixture().readers)
    try {
      await settle()
      await act(async () => { box.current?.tree.handleFocus() })
      await key({ box, name: 'right' })
      expect(box.current?.tree.cursor).toBe('notes')
      await key({ box, name: 'right' })
      expect(box.current?.tree.cursor).toBe('notes/deep')
      await key({ box, name: 'left' })
      expect(box.current?.tree.cursor).toBe('notes')
      await key({ box, name: 'left' })
      expect(pathsOf(box)).toEqual(['notes', 'plan.md'])
      await key({ box, name: 'down' })
      expect(box.current?.tree.cursor).toBe('plan.md')
      await key({ box, name: 'return' })
      expect(box.current?.viewer?.path).toBe('plan.md')
      expect(box.current?.tree.focused).toBe(false)
      await key({ box, name: 'tab' })
      expect(box.current?.tree.focused).toBe(true)
      await key({ box, name: 'escape' })
      expect(box.current?.tree.focused).toBe(false)
      expect(box.current?.viewer?.path).toBe('plan.md')
      await key({ box, name: 'escape' })
      expect(box.current?.viewer).toBeNull()
    } finally { await teardown(setup) }
  })

  it('refreshes expanded levels and the selected file without forgetting expansion', async () => {
    const source = fixture()
    const { box, setup } = await probe(source.readers)
    try {
      await settle()
      await activate({ box, path: 'notes' })
      await activate({ box, path: 'notes/plan.md' })
      source.levels.set('notes', [{ name: 'plan.md', isDirectory: false }, { name: 'new.md', isDirectory: false }])
      source.update('updated')
      await act(async () => { source.emit() })
      await settle()
      expect(pathsOf(box)).toContain('notes/new.md')
      expect(box.current?.tree.expanded.has('notes')).toBe(true)
      expect(box.current?.tree.opened).toBe('notes/plan.md')
      expect(box.current?.viewer).toEqual({ state: EContextView.Ready, path: 'notes/plan.md',
        content: { type: 'text', content: 'notes/plan.md: updated', truncated: false } })
    } finally { await teardown(setup) }
  })

  it('does not fetch collapsed descendants and drops removed directories after a refresh', async () => {
    const source = fixture()
    const { box, setup } = await probe(source.readers)
    try {
      await settle()
      expect(source.asked).not.toContain('notes')
      await activate({ box, path: 'notes' })
      expect(source.asked).toContain('notes')
      expect(source.asked).not.toContain('notes/deep')
      source.levels.set('', [{ name: 'plan.md', isDirectory: false }])
      await act(async () => { source.emit() })
      await settle()
      expect(pathsOf(box)).toEqual(['plan.md'])
      expect(box.current?.tree.cursor).toBe('plan.md')
    } finally { await teardown(setup) }
  })
})
