import type { ScrollBoxRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act, useRef } from 'react'

import { useEntryWindow } from '../use-entry-window'
import { useTranscriptFollow } from '../use-transcript-follow'

const WIDTH = 40
const VIEWPORT = 10
const ENTRY_COUNT = 300
const TALL = 8
const SHORT = 2

type Entry = { key: string; rows: number; label: string }

const entry = (index: number, rows: number): Entry => ({
  key: `e${index}`,
  rows,
  label: `entry ${index}`,
})

type Holder = {
  box: ScrollBoxRenderable | null
  prepend: (() => void) | null
}

function Harness(props: { entries: readonly Entry[]; holder: Holder }): React.ReactNode {
  const scroller = useRef<ScrollBoxRenderable | null>(null)
  const windowing = useEntryWindow({
    entries: props.entries,
    scroller,
    anchorIndex: -1,
    width: WIDTH,
  })
  useTranscriptFollow({
    scroller,
    onTick: windowing.handleTick,
    offsetOfKey: windowing.offsetOfKey,
  })

  const firstKey = useRef<string | null>(null)
  React.useLayoutEffect(() => {
    const first = props.entries[0]?.key ?? null
    const previous = firstKey.current
    firstKey.current = first
    if (previous === null || first === previous) return
    const box = scroller.current
    if (box === null) return
    windowing.pinToKey({ key: previous, offset: box.scrollTop })
  }, [props.entries, windowing])

  const mounted: React.ReactNode[] = []
  windowing.sections.forEach((section, sectionIndex) => {
    if (section.kind === 'spacer') {
      mounted.push(<box key={`spacer:${sectionIndex}`} height={section.height} flexShrink={0} />)
      return
    }
    for (const entry of props.entries.slice(section.span.start, section.span.end)) {
      mounted.push(
        <box key={entry.key} id={entry.key} height={entry.rows} flexShrink={0} flexDirection="column">
          <text>{entry.label}</text>
        </box>,
      )
    }
  })

  return (
    <box flexDirection="column" width={WIDTH} height={VIEWPORT}>
      <scrollbox
        ref={(box) => {
          scroller.current = box
          props.holder.box = box
        }}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        stickyScroll
        stickyStart="bottom"
        viewportCulling
      >
        {mounted}
      </scrollbox>
    </box>
  )
}

function StatefulHarness(props: {
  initial: readonly Entry[]
  older: readonly Entry[]
  holder: Holder
}): React.ReactNode {
  const [entries, setEntries] = React.useState<readonly Entry[]>(props.initial)
  React.useEffect(() => {
    props.holder.prepend = () => setEntries((current) => [...props.older, ...current])
  }, [props.holder, props.older])
  return <Harness entries={entries} holder={props.holder} />
}

async function settle(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  for (let pass = 0; pass < 12; pass += 1) {
    await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
}

function childOf(box: ScrollBoxRenderable, key: string): { y: number } | undefined {
  return box.content.getChildren().find((child) => child.id === key)
}

describe('the windowed transcript scroll anchor', () => {
  it('keeps the painted entry under the viewport when a window slide measures taller rows', async () => {
    const entries = Array.from({ length: ENTRY_COUNT }, (_, index) =>
      entry(index, index < 140 ? TALL : SHORT),
    )
    const holder: Holder = { box: null, prepend: null }
    const setup = await testRender(<Harness entries={entries} holder={holder} />, {
      width: WIDTH,
      height: VIEWPORT,
    })
    try {
      await settle(setup)
      const box = holder.box
      if (box === null) throw new Error('the scrollbox never mounted')

      await act(async () => {
        box.scrollTo(600)
        await setup.flush()
      })
      await settle(setup)

      const topLine = setup.captureCharFrame().split('\n')[0] ?? ''
      expect(topLine).toContain('entry 89')
      expect(box.scrollTop).toBe(89 * TALL)
    } finally {
      setup.renderer.destroy()
    }
  })

  it('keeps the reading position when older history prepends above the window', async () => {
    const initial = Array.from({ length: ENTRY_COUNT }, (_, index) =>
      entry(index + 150, SHORT),
    )
    const older = Array.from({ length: 150 }, (_, index) => entry(index, TALL))
    const holder: Holder = { box: null, prepend: null }
    const setup = await testRender(
      <StatefulHarness initial={initial} older={older} holder={holder} />,
      { width: WIDTH, height: VIEWPORT },
    )
    try {
      await settle(setup)
      const box = holder.box
      if (box === null) throw new Error('the scrollbox never mounted')

      await act(async () => {
        box.scrollTo(6)
        await setup.flush()
      })
      await settle(setup)

      const prepend = holder.prepend
      if (prepend === null) throw new Error('the prepend hook never registered')
      await act(async () => {
        prepend()
        await setup.flush()
      })
      await settle(setup)

      const first = childOf(box, 'e150')
      expect(first).toBeDefined()
      expect(first?.y).toBe(box.viewport.y - 6)
      const topmost = childOf(box, 'e153')
      expect(topmost).toBeDefined()
      expect(topmost?.y).toBe(box.viewport.y)
    } finally {
      setup.renderer.destroy()
    }
  })
})
