import type { ScrollBoxRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { teardown } from '../markdown/__tests__/harness'
import { encodePng } from '../images/__tests__/png-fixture'
import { ContextViewer } from '../components/context-viewer'

const WIDTH = 60
const HEIGHT = 14

const PNG = ((): string => {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let pixel = 0; pixel < 8 * 8; pixel += 1) rgba.set([220, 20, 60, 255], pixel * 4)
  return Buffer.from(encodePng({ width: 8, height: 8, colourType: 6, bytesPerPixel: 4, samples: rgba })).toString('base64')
})()

/** Any of the quadrant glyphs the block sampler paints with. */
const painted = (frame: string): boolean => /[▀-▟]/.test(frame)

const settle = async (flush: () => Promise<void>): Promise<void> => {
  for (let pass = 0; pass < 10; pass += 1) {
    await Bun.sleep(3)
    await flush()
  }
}

const mount = (node: React.ReactNode) =>
  testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      {node}
    </box>,
    { width: WIDTH, height: HEIGHT },
  )

describe('the context viewer', () => {
  it('shows the file with the line-number gutter and the path pinned right', async () => {
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="plan.md"
        loading={false}
        content={{ type: 'text', content: 'first line\nsecond line', truncated: false }}
        onDismiss={() => undefined}
        attachScroll={() => undefined}
      />,
    )
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('context')
      expect(frame).toContain('plan.md')
      expect(frame).toContain('first line')
      expect(frame).toContain('second line')
      expect(frame).toContain('pgup/pgdn page · esc to close')
    } finally {
      await teardown(setup)
    }
  })

  it('reads a refusal as a plain line, never a crash', async () => {
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="bin.dat"
        loading={false}
        content={{ type: 'refused', reason: 'the file is binary' }}
        onDismiss={() => undefined}
        attachScroll={() => undefined}
      />,
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('the file is binary')
    } finally {
      await teardown(setup)
    }
  })

  it('scrolls a long file all the way to its final line', async () => {
    const held: { box: ScrollBoxRenderable | null } = { box: null }
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="big.log"
        loading={false}
        content={{ type: 'text', content: Array.from({ length: 500 }, (_, index) => `file-line-${index + 1}`).join('\n'), truncated: false }}
        onDismiss={() => undefined}
        attachScroll={(box) => { held.box = box }}
      />,
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('file-line-1')
      expect(setup.captureCharFrame()).not.toContain('file-line-500')
      await act(async () => { held.box?.scrollTo(10000) })
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('500 file-line-500')
    } finally {
      await teardown(setup)
    }
  })

  it('says so while the read is in flight', async () => {
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="plan.md"
        loading={true}
        content={null}
        onDismiss={() => undefined}
        attachScroll={() => undefined}
      />,
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('Reading plan.md…')
    } finally {
      await teardown(setup)
    }
  })

  it('dismisses through the back pill click', async () => {
    let dismissed = 0
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="plan.md"
        loading={false}
        content={{ type: 'text', content: 'one', truncated: false }}
        onDismiss={() => { dismissed += 1 }}
        attachScroll={() => undefined}
      />,
    )
    try {
      await setup.flush()
      const rows = setup.captureCharFrame().split('\n')
      const row = rows.findIndex((line) => line.includes('context'))
      const column = (rows[row] ?? '').indexOf('context')
      expect(row).toBeGreaterThanOrEqual(0)

      await act(async () => {
        await setup.mockMouse.click(Math.max(0, column - 1), row)
      })
      await setup.flush()

      expect(dismissed).toBe(1)
    } finally {
      await teardown(setup)
    }
  })

  it('pans sideways to the tail of a long line', async () => {
    const held: { box: ScrollBoxRenderable | null } = { box: null }
    const lead = 'const value = "'
    const tail = 'REACHED"'
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="wide.ts"
        loading={false}
        content={{ type: 'text', content: `${lead}${'x'.repeat(120)}${tail}`, truncated: false }}
        onDismiss={() => undefined}
        attachScroll={(box) => { held.box = box }}
      />,
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain(lead)
      expect(setup.captureCharFrame()).not.toContain(tail.trim())
      await act(async () => { held.box?.scrollBy({ x: 200, y: 0 }) })
      await setup.flush()
      expect(setup.captureCharFrame()).toContain(tail.trim())
    } finally {
      await teardown(setup)
    }
  })

  it('declines an image where the terminal cannot paint one, rather than corrupting the cells around it', async () => {
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="shot.png"
        loading={false}
        content={{ type: 'image', data: PNG, mediaType: 'image/png' }}
        onDismiss={() => undefined}
        attachScroll={() => undefined}
      />,
    )
    try {
      await setup.flush()
      await settle(setup.flush)
      const frame = setup.captureCharFrame()
      expect(frame).toContain('shot.png')
      expect(frame).toContain('cannot display')
      expect(painted(frame)).toBe(false)
      expect(frame).not.toContain('binary')
    } finally {
      await teardown(setup)
    }
  })

  it('renders a markdown file as document, not as highlighted source', async () => {
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="notes.md"
        loading={false}
        content={{ type: 'text', content: '# Heading\n\nsome **bold** words', truncated: false }}
        onDismiss={() => undefined}
        attachScroll={() => undefined}
      />,
    )
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('bold')
      expect(frame).not.toContain('**bold**')
      expect(frame).not.toContain('# Heading')
      expect(frame).toContain('Heading')
    } finally {
      await teardown(setup)
    }
  })

  it('keeps non-markdown files on the highlighted code path', async () => {
    const setup = await mount(
      <ContextViewer
        width={WIDTH}
        path="notes.ts"
        loading={false}
        content={{ type: 'text', content: 'const a = 1', truncated: false }}
        onDismiss={() => undefined}
        attachScroll={() => undefined}
      />,
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('const a = 1')
    } finally {
      await teardown(setup)
    }
  })
})
