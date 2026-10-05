import { afterEach, describe, expect, test } from 'bun:test'
import type { OptimizedBuffer } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyTranscriptBounds } from '../../viewport-rows-store'
import { TranscriptImageRenderable } from '../transcript-image'
import '../transcript-image'
import { encodePng } from './png-fixture'

const rgba = new Uint8Array(8 * 8 * 4)
for (let pixel = 0; pixel < 8 * 8; pixel += 1) rgba.set([220, 20, 60, 255], pixel * 4)
const PATH = join(mkdtempSync(join(tmpdir(), 'atlas-transcript-image-')), 'fixture.png')
writeFileSync(PATH, encodePng({ width: 8, height: 8, colourType: 6, bytesPerPixel: 4, samples: rgba }))

/** Any of the quadrant glyphs the block sampler paints with; a gradient need not produce a solid one. */
const painted = (frame: string): boolean => /[▀-▟]/.test(frame)

const heldTermProgram = process.env.TERM_PROGRAM

afterEach(() => {
  applyTranscriptBounds({ top: 0, rows: 0 })
  if (heldTermProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = heldTermProgram
})

const settle = async (flush: () => Promise<void>): Promise<void> => {
  for (let pass = 0; pass < 10; pass += 1) {
    await Bun.sleep(3)
    await flush()
  }
}

const paint = async (protocol: 'blocks' | 'kitty' = 'blocks'): Promise<string> => {
  const { renderOnce, flush, captureCharFrame } = await testRender(
    <box paddingTop={2} flexDirection="column">
      <transcript-image source={PATH} protocol={protocol} fit="fit" style={{ width: 10, height: 5 }} />
    </box>,
    { width: 20, height: 12 },
  )
  await renderOnce()
  await settle(flush)
  return captureCharFrame()
}

/** Headless kitty never reaches the char frame, so the withhold decision is observed through renderSelf. */
const renderDecision = async (protocol: 'blocks' | 'kitty'): Promise<boolean> => {
  const seen: { node: TranscriptImageRenderable | null } = { node: null }
  const { renderOnce, flush } = await testRender(
    <transcript-image
      ref={(node: TranscriptImageRenderable) => {
        seen.node = node
      }}
      source={PATH}
      protocol={protocol}
      fit="fit"
      style={{ width: 10, height: 5 }}
    />,
    { width: 20, height: 12 },
  )
  await renderOnce()
  await settle(flush)

  if (seen.node === null) throw new Error('transcript-image never mounted')
  const node = seen.node
  let paintedIt = false
  const probe = {
    drawImage: () => {
      paintedIt = true
    },
  }
  node['renderSelf'](probe as unknown as OptimizedBuffer)
  return paintedIt
}

describe('a transcript picture', () => {
  test('paints when the whole of it is inside the viewport', async () => {
    applyTranscriptBounds({ top: 0, rows: 12 })

    expect(painted(await paint())).toBe(true)
  })

  test('paints its visible crop when its top is scrolled out of the viewport', async () => {
    applyTranscriptBounds({ top: 4, rows: 8 })

    expect(painted(await paint())).toBe(true)
  })

  test('paints its visible crop when its bottom runs past the viewport too', async () => {
    applyTranscriptBounds({ top: 0, rows: 4 })

    expect(painted(await paint())).toBe(true)
  })

  test('paints when nothing has measured the transcript yet', async () => {
    applyTranscriptBounds({ top: 0, rows: 0 })

    expect(painted(await paint())).toBe(true)
  })

  test('withholds a crop only on Warp’s kitty path, which discards source rectangles', async () => {
    process.env.TERM_PROGRAM = 'WarpTerminal'
    applyTranscriptBounds({ top: 4, rows: 8 })

    expect(await renderDecision('kitty')).toBe(false)
  })

  test('still paints a fully visible picture on Warp’s kitty path', async () => {
    process.env.TERM_PROGRAM = 'WarpTerminal'
    applyTranscriptBounds({ top: 0, rows: 12 })

    expect(await renderDecision('kitty')).toBe(true)
  })
})

describe('a transcript picture with an explicit protocol', () => {
  test('keeps the caller’s choice even under Warp', async () => {
    process.env.TERM_PROGRAM = 'WarpTerminal'

    const seen: { node: TranscriptImageRenderable | null } = { node: null }
    const { renderOnce, flush } = await testRender(
      <transcript-image
        ref={(node: TranscriptImageRenderable) => {
          seen.node = node
        }}
        source={PATH}
        protocol="kitty"
        fit="fit"
        style={{ width: 10, height: 5 }}
      />,
      { width: 20, height: 12 },
    )
    await renderOnce()
    await flush()

    if (seen.node === null) throw new Error('transcript-image never mounted')
    expect(seen.node.effectiveProtocol).toBe('kitty')
  })
})
