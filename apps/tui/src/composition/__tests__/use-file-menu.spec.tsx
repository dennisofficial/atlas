import type { MentionReader } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { useEffect } from 'react'

import { useFileMenu, type FileMenuControl } from '../use-file-menu'
import {
  file,
  mountProbe,
  press,
  scriptedReader,
  trackUnhandledRejections,
  type Mounted,
} from './mention-reader-fixture'

type Props = { files: MentionReader | undefined }

type Probe = {
  control: FileMenuControl | null
  completions: string[]
  problems: string[]
}

const probe: Probe = { control: null, completions: [], problems: [] }

function Menu(props: Props): React.ReactNode {
  probe.control = useFileMenu({
    files: props.files,
    onComplete: (text) => probe.completions.push(text),
    onProblem: (reason) => probe.problems.push(reason),
  })
  return <text>{probe.control.state === null ? 'closed' : 'open'}</text>
}

const control = (): FileMenuControl => {
  if (probe.control === null) throw new Error('the probe never mounted')
  return probe.control
}

const names = (): string[] => control().state?.matches.map((entry) => entry.name) ?? []

const open: Mounted<Props>[] = []

async function mounted(files: MentionReader | undefined): Promise<Mounted<Props>> {
  probe.control = null
  probe.completions = []
  probe.problems = []
  const harness = await mountProbe<Props>({
    render: (props) => <Menu {...props} />,
    props: { files },
  })
  open.push(harness)
  return harness
}

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.done()
})

describe('the file menu over a mention reader', () => {
  it('opens on a listing, then moves, completes and dismisses as before', async () => {
    const reader = scriptedReader()
    const harness = await mounted(reader)

    await harness.act(() => control().handleTextChanged('look at @re'))
    expect(reader.listed).toEqual([''])
    await harness.act(() => reader.pendingLists[0]?.resolve([file('readme.md'), file('recipe.md')]))
    expect(names()).toEqual(['readme.md', 'recipe.md'])

    await harness.act(() => void control().handleKey(press('down')))
    expect(control().state?.index).toBe(1)

    await harness.act(() => void control().handleKey(press('tab')))
    expect(harness.setup.renderer.isDestroyed).toBe(false)
    expect(probe.completions).toHaveLength(1)
    expect(probe.completions[0]).toContain('recipe.md')
    expect(control().state).toBeNull()

    await harness.act(() => control().handleTextChanged('@re'))
    await harness.act(() => reader.pendingLists[1]?.resolve([file('readme.md')]))
    await harness.act(() => void control().handleKey(press('escape')))
    expect(control().state).toBeNull()
  })

  it('falls through keys while closed', async () => {
    await mounted(scriptedReader())

    for (const name of ['up', 'down', 'tab', 'return', 'escape']) {
      expect(control().handleKey(press(name))).toBe(false)
    }
  })

  it('drops a listing that lands after the developer typed on', async () => {
    const reader = scriptedReader()
    const harness = await mounted(reader)

    await harness.act(() => control().handleTextChanged('@r'))
    await harness.act(() => control().handleTextChanged('@re'))
    await harness.act(() => reader.pendingLists[0]?.resolve([file('stale.md')]))
    expect(control().state).toBeNull()

    await harness.act(() => reader.pendingLists[1]?.resolve([file('readme.md')]))
    expect(names()).toEqual(['readme.md'])
  })

  it('clears the old listing at once and re-reads the typed query on a new reader', async () => {
    const local = scriptedReader()
    const cloud = scriptedReader()
    const harness = await mounted(local)

    await harness.act(() => control().handleTextChanged('@src/ap'))
    await harness.act(() => local.pendingLists[0]?.resolve([file('app.ts')]))
    expect(names()).toEqual(['app.ts'])

    await harness.rerender({ files: cloud })
    expect(control().state).toBeNull()
    expect(cloud.listed).toEqual(['src/'])

    await harness.act(() => cloud.pendingLists[0]?.resolve([file('apple.ts')]))
    expect(names()).toEqual(['apple.ts'])
  })

  it('never shows a previous reader’s late answer', async () => {
    const local = scriptedReader()
    const cloud = scriptedReader()
    const harness = await mounted(local)

    await harness.act(() => control().handleTextChanged('@re'))
    await harness.rerender({ files: cloud })

    await harness.act(() => local.pendingLists[0]?.resolve([file('reader-local.md')]))
    expect(control().state).toBeNull()

    await harness.act(() => cloud.pendingLists[0]?.resolve([file('reader-cloud.md')]))
    expect(names()).toEqual(['reader-cloud.md'])
  })

  it('closes when the reader goes away and ignores its late answer', async () => {
    const reader = scriptedReader()
    const harness = await mounted(reader)

    await harness.act(() => control().handleTextChanged('@re'))
    await harness.rerender({ files: undefined })
    await harness.act(() => reader.pendingLists[0]?.resolve([file('late.md')]))

    expect(control().state).toBeNull()
  })

  it('reports a rejected listing through onProblem without an unhandled rejection', async () => {
    const watch = trackUnhandledRejections()
    try {
      const reader = scriptedReader()
      const harness = await mounted(reader)

      await harness.act(() => control().handleTextChanged('@re'))
      await harness.act(() => reader.pendingLists[0]?.reject(new Error('the sandbox is parked')))
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(control().state).toBeNull()
      expect(probe.problems).toHaveLength(1)
      expect(probe.problems[0]).toContain('the sandbox is parked')
      expect(watch.seen).toEqual([])
    } finally {
      watch.stop()
    }
  })

  it('swallows a rejection quietly when no onProblem is given', async () => {
    const watch = trackUnhandledRejections()
    try {
      const reader = scriptedReader()
      function Bare(props: Props): React.ReactNode {
        const menu = useFileMenu({ files: props.files, onComplete: () => undefined })
        useEffect(() => menu.handleTextChanged('@re'), [menu.handleTextChanged])
        return <text>bare</text>
      }
      const harness = await mountProbe<Props>({
        render: (props) => <Bare {...props} />,
        props: { files: reader },
      })
      open.push(harness)

      await harness.act(() => reader.pendingLists[0]?.reject(new Error('gone')))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(watch.seen).toEqual([])
    } finally {
      watch.stop()
    }
  })
})
