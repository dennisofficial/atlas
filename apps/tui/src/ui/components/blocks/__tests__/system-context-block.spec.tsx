import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, test } from 'bun:test'
import React, { act, useState } from 'react'

import { EAuthor, EEntryKind, type SystemContextEntry } from '../../../../store/transcript-model'
import { SystemContextBlock } from '../system-context-block'
import { injectionKey, openedInjectionsOf } from '../system-context-expansion'

type Setup = Awaited<ReturnType<typeof testRender>>

const mounted: Setup[] = []

afterAll(() => {
  for (const setup of mounted) setup.renderer.destroy()
})

const item = (key: string, label: string, content: string) => ({
  key,
  label,
  content,
  superseded: false,
})

const group: SystemContextEntry = {
  kind: EEntryKind.SystemContext,
  author: EAuthor.Model,
  key: 'g1',
  text: '3 prompts',
  items: [
    item('a', 'global instructions', 'GLOBAL BODY'),
    item('b', 'memory', 'MEMORY BODY'),
    item('c', 'skill suggestion · ui-design', 'SKILL BODY'),
  ],
}

function Harness(props: { entry: SystemContextEntry }): React.ReactNode {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const handleToggle = (key: string): void => {
    setOpened((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  return (
    <SystemContextBlock
      entry={props.entry}
      width={80}
      expanded={opened.has(props.entry.key)}
      opened={opened}
      onToggle={handleToggle}
    />
  )
}

const mount = async (entry: SystemContextEntry): Promise<Setup> => {
  const setup = await testRender(<Harness entry={entry} />, { width: 80, height: 16 })
  mounted.push(setup)
  await setup.flush()
  return setup
}

const rowOf = (setup: Setup, text: string): number =>
  setup.captureCharFrame().split('\n').findIndex((line) => line.includes(text))

const clickRow = async (setup: Setup, text: string): Promise<void> => {
  const row = rowOf(setup, text)
  expect(row).toBeGreaterThanOrEqual(0)
  await act(async () => {
    await setup.mockMouse.click(6, row)
    await setup.flush()
  })
  await setup.flush()
}

describe('a group of injected prompts', () => {
  test('collapses to one row naming the count', async () => {
    const setup = await mount(group)

    const frame = setup.captureCharFrame()
    expect(frame).toContain('○ Atlas loaded 3 prompts')
    expect(frame).not.toContain('global instructions')
    expect(frame).not.toContain('GLOBAL BODY')
  })

  test('opens to one collapsed row per item, with no content', async () => {
    const setup = await mount(group)

    await clickRow(setup, 'Atlas loaded 3 prompts')

    const frame = setup.captureCharFrame()
    expect(frame).toContain('global instructions')
    expect(frame).toContain('memory')
    expect(frame).toContain('skill suggestion · ui-design')
    expect(frame).not.toContain('GLOBAL BODY')
    expect(frame).not.toContain('MEMORY BODY')
  })

  test('opens one item at a time and folds it back', async () => {
    const setup = await mount(group)
    await clickRow(setup, 'Atlas loaded 3 prompts')

    await clickRow(setup, 'memory')
    expect(setup.captureCharFrame()).toContain('MEMORY BODY')
    expect(setup.captureCharFrame()).not.toContain('GLOBAL BODY')

    await clickRow(setup, 'memory')
    expect(setup.captureCharFrame()).not.toContain('MEMORY BODY')
  })

  test('folds the list away without losing which item was open', async () => {
    const setup = await mount(group)
    await clickRow(setup, 'Atlas loaded 3 prompts')
    await clickRow(setup, 'memory')
    await clickRow(setup, 'Atlas loaded 3 prompts')
    expect(setup.captureCharFrame()).not.toContain('MEMORY BODY')

    await clickRow(setup, 'Atlas loaded 3 prompts')
    expect(setup.captureCharFrame()).toContain('MEMORY BODY')
  })

  test('marks a superseded item on its row', async () => {
    const setup = await mount({
      ...group,
      items: group.items.map((each) => (each.key === 'b' ? { ...each, superseded: true } : each)),
    })
    await clickRow(setup, 'Atlas loaded 3 prompts')

    expect(setup.captureCharFrame()).toContain('memory · superseded')
  })
})

describe('a single injected prompt', () => {
  const single: SystemContextEntry = {
    ...group,
    key: 'g2',
    text: 'memory',
    items: [item('only', 'memory', 'ONLY BODY')],
  }

  test('is not a group: one click opens its content', async () => {
    const setup = await mount(single)
    expect(setup.captureCharFrame()).toContain('○ Atlas loaded memory')

    await clickRow(setup, 'Atlas loaded memory')

    expect(setup.captureCharFrame()).toContain('ONLY BODY')
  })
})

describe('the expansion subset', () => {
  test('keeps only the keys this entry owns and holds identity while they are unchanged', () => {
    const cache = new WeakMap()
    const first = openedInjectionsOf({
      cache,
      entry: group,
      opened: new Set(['g1', injectionKey('b'), 'unrelated']),
    })
    const second = openedInjectionsOf({
      cache,
      entry: group,
      opened: new Set(['g1', injectionKey('b'), 'other']),
    })

    expect([...first].sort()).toEqual(['g1', injectionKey('b')].sort())
    expect(second).toBe(first)
  })
})
