import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'

import { teardown } from '../../ui/markdown/__tests__/harness'
import type { ContextReaders } from '../session-binding'
import { EContextView, useContextBrowser, type ContextControl } from '../use-context'

type Held = { current: ContextControl | null }

async function probe(readers: ContextReaders): Promise<{ box: Held; setup: Awaited<ReturnType<typeof testRender>> }> {
  const box: Held = { current: null }
  const Probe = (): null => {
    box.current = useContextBrowser({ readers })
    return null
  }
  const setup = await testRender(<Probe />, { width: 20, height: 5 })
  return { box, setup }
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

const readersOf = (args: {
  entries?: Array<{ name: string; isDirectory: boolean }>
  content?: Awaited<ReturnType<ContextReaders['load']>>
}): ContextReaders => ({
  subscribe: () => () => {},
  list: async () => args.entries ?? [],
  load: async () => args.content ?? { type: 'refused', reason: 'missing' },
})

describe('useContextBrowser', () => {
  it('loads the listing on mount', async () => {
    const { box, setup } = await probe(readersOf({ entries: [{ name: 'plan.md', isDirectory: false }] }))

    await settle()

    expect(box.current?.loading).toBe(false)
    expect(box.current?.entries).toEqual([{ name: 'plan.md', isDirectory: false }])
    await teardown(setup)
  })

  it('keeps the row list identity when a refresh answers the same entries', async () => {
    const { box, setup } = await probe(readersOf({ entries: [{ name: 'a.md', isDirectory: false }] }))
    await settle()
    const first = box.current?.entries

    await settle()

    expect(box.current?.entries).toBe(first)
    await teardown(setup)
  })

  it('opens a file, loads it, and dismisses back to the transcript', async () => {
    const { box, setup } = await probe(
      readersOf({ content: { type: 'text', content: 'hello', truncated: false } }),
    )

    await act(async () => {
      box.current?.handleOpen('plan.md')
    })

    await settle()
    expect(box.current?.viewer).toEqual({
      state: EContextView.Ready,
      path: 'plan.md',
      content: { type: 'text', content: 'hello', truncated: false },
    })

    await act(async () => {
      box.current?.handleDismiss()
    })
    expect(box.current?.viewer).toBeNull()
    await teardown(setup)
  })

  it('navigates directories and returns to their parent', async () => {
    const readers: ContextReaders = {
      subscribe: () => () => {},
      list: async (directory) => directory === 'notes' ? [{ name: 'plan.md', isDirectory: false }] : [{ name: 'notes', isDirectory: true }],
      load: async () => ({ type: 'text', content: 'nested plan', truncated: false }),
    }
    const { box, setup } = await probe(readers)
    try {
      await settle()
      await act(async () => { box.current?.handleOpen('notes') })
      await settle()
      expect(box.current?.directory).toBe('notes')
      expect(box.current?.viewer).toBeNull()
      await act(async () => { box.current?.handleOpen('plan.md') })
      await settle()
      expect(box.current?.viewer?.path).toBe('notes/plan.md')
      await act(async () => { box.current?.handleDismiss(); box.current?.handleUp() })
      await settle()
      expect(box.current?.directory).toBe('')
    } finally { await teardown(setup) }
  })

  it('reloads a selected file on a notification without changing selection', async () => {
    let content = 'first'
    let emit: () => void = () => {}
    const readers: ContextReaders = {
      list: async () => [{ name: 'plan.md', isDirectory: false }],
      load: async () => ({ type: 'text', content, truncated: false }),
      subscribe: (listener) => { emit = listener; return () => { emit = () => {} } },
    }
    const { box, setup } = await probe(readers)
    try {
      await act(async () => { box.current?.handleOpen('plan.md') })
      await settle()
      content = 'updated'
      await act(async () => { emit() })
      await settle()
      expect(box.current?.viewer).toEqual({ state: EContextView.Ready, path: 'plan.md',
        content: { type: 'text', content: 'updated', truncated: false } })
    } finally { await teardown(setup) }
  })

  it('reads escape as a dismiss and swallows nothing else', async () => {
    const { box, setup } = await probe(readersOf({ content: { type: 'text', content: 'one', truncated: false } }))
    await act(async () => {
      box.current?.handleOpen('plan.md')
    })
    await settle()
    expect(box.current?.viewer?.state).toBe(EContextView.Ready)

    await act(async () => {
      box.current?.handleKey({ name: 'escape' })
    })
    expect(box.current?.viewer).toBeNull()
    await teardown(setup)
  })
})
