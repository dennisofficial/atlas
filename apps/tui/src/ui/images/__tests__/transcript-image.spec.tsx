import { afterEach, describe, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyTranscriptBounds } from '../../viewport-rows-store'
import '../transcript-image'
import { encodePng } from './png-fixture'

const rgba = new Uint8Array(8 * 8 * 4)
for (let pixel = 0; pixel < 8 * 8; pixel += 1) rgba.set([220, 20, 60, 255], pixel * 4)
const PATH = join(mkdtempSync(join(tmpdir(), 'atlas-transcript-image-')), 'fixture.png')
writeFileSync(PATH, encodePng({ width: 8, height: 8, colourType: 6, bytesPerPixel: 4, samples: rgba }))

/** Any of the quadrant glyphs the block sampler paints with; a gradient need not produce a solid one. */
const painted = (frame: string): boolean => /[\u2580-\u259f]/.test(frame)

afterEach(() => applyTranscriptBounds({ top: 0, rows: 0 }))

const settle = async (flush: () => Promise<void>): Promise<void> => {
  for (let pass = 0; pass < 10; pass += 1) {
    await Bun.sleep(3)
    await flush()
  }
}

const paint = async (): Promise<string> => {
  const { renderOnce, flush, captureCharFrame } = await testRender(
    <box paddingTop={2} flexDirection="column">
      <transcript-image source={PATH} protocol="blocks" fit="fit" style={{ width: 10, height: 5 }} />
    </box>,
    { width: 20, height: 12 },
  )
  await renderOnce()
  await settle(flush)
  return captureCharFrame()
}

describe('a transcript picture', () => {
  test('paints when the whole of it is inside the viewport', async () => {
    applyTranscriptBounds({ top: 0, rows: 12 })

    expect(painted(await paint())).toBe(true)
  })

  test('withholds itself rather than asking for a crop Warp would ignore', async () => {
    applyTranscriptBounds({ top: 4, rows: 8 })

    expect(painted(await paint())).toBe(false)
  })

  test('withholds itself when its bottom runs past the viewport too', async () => {
    applyTranscriptBounds({ top: 0, rows: 4 })

    expect(painted(await paint())).toBe(false)
  })

  test('paints when nothing has measured the transcript yet', async () => {
    applyTranscriptBounds({ top: 0, rows: 0 })

    expect(painted(await paint())).toBe(true)
  })
})
