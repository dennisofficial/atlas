import { afterEach, describe, expect, test } from 'bun:test'
import type { NativeImage, OptimizedBuffer } from '@opentui/core'
import { setRendererCapabilities } from '@opentui/core/testing'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TranscriptImageRenderable } from '../transcript-image'
import '../transcript-image'
import { encodePng } from './png-fixture'

const rgba = new Uint8Array(8 * 8 * 4)
for (let pixel = 0; pixel < 8 * 8; pixel += 1) rgba.set([220, 20, 60, 255], pixel * 4)
const PATH = join(mkdtempSync(join(tmpdir(), 'atlas-transcript-image-')), 'fixture.png')
writeFileSync(PATH, encodePng({ width: 8, height: 8, colourType: 6, bytesPerPixel: 4, samples: rgba }))

const BUFFER = { width: 20, height: 12 }
const IMAGE_ARGUMENT = 0
const SOURCE_ARGUMENTS = [7, 8, 9, 10] as const
const DESTINATION_ARGUMENTS = [1, 2, 3, 4] as const
const PROTOCOL_ARGUMENT = 11

const painted = (frame: string): boolean => /[▀-▟]/.test(frame)

const heldTermProgram = process.env.TERM_PROGRAM

afterEach(() => {
  if (heldTermProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = heldTermProgram
})

const settle = async (flush: () => Promise<void>): Promise<void> => {
  for (let pass = 0; pass < 10; pass += 1) {
    await Bun.sleep(3)
    await flush()
  }
}

const paintBlocks = async (): Promise<string> => {
  const { renderOnce, flush, captureCharFrame } = await testRender(
    <box paddingTop={2} flexDirection="column">
      <transcript-image source={PATH} protocol="blocks" fit="fit" style={{ width: 10, height: 5 }} />
    </box>,
    { width: BUFFER.width, height: BUFFER.height },
  )
  await renderOnce()
  await settle(flush)
  return captureCharFrame()
}

type Drawn = {
  bitmap: { width: number; height: number }
  source: number[]
  destination: number[]
  protocol: unknown
}

const argumentsAt = (call: unknown[], indexes: readonly number[]): number[] =>
  indexes.map((index) => Number(call[index]))

const drawnWith = async (args: { clipHeight: number | null; protocol: 'kitty' | 'auto' }): Promise<Drawn | null> => {
  process.env.TERM_PROGRAM = 'WarpTerminal'
  const seen: { node: TranscriptImageRenderable | null } = { node: null }
  const picture = (
    <transcript-image
      ref={(node: TranscriptImageRenderable) => {
        seen.node = node
      }}
      source={PATH}
      protocol={args.protocol}
      fit="fit"
      style={{ width: 10, height: 5, flexShrink: 0 }}
    />
  )
  const { renderer, renderOnce, flush } = await testRender(
    <box paddingTop={2} flexDirection="column">
      {args.clipHeight === null ? (
        picture
      ) : (
        <box overflow="hidden" style={{ width: 20, height: args.clipHeight }}>
          {picture}
        </box>
      )}
    </box>,
    BUFFER,
  )
  setRendererCapabilities(renderer, { kitty_graphics: true })
  await renderOnce()
  await settle(flush)

  if (seen.node === null) throw new Error('transcript-image never mounted')
  const calls: unknown[][] = []
  const probe = {
    ...BUFFER,
    drawImage: (...call: unknown[]) => {
      calls.push(call)
      return true
    },
  }
  seen.node['renderSelf'](probe as unknown as OptimizedBuffer)
  const call = calls.at(-1)
  if (call === undefined) return null
  const image = call[IMAGE_ARGUMENT] as NativeImage
  return {
    bitmap: { width: image.width, height: image.height },
    source: argumentsAt(call, SOURCE_ARGUMENTS),
    destination: argumentsAt(call, DESTINATION_ARGUMENTS),
    protocol: call[PROTOCOL_ARGUMENT],
  }
}

describe('a transcript picture painted with blocks', () => {
  test('paints into the character frame', async () => {
    expect(painted(await paintBlocks())).toBe(true)
  })
})

describe('a transcript picture on Warp’s kitty path', () => {
  test('forwards the whole bitmap when it is fully visible', async () => {
    expect(await drawnWith({ clipHeight: null, protocol: 'kitty' })).toEqual({
      bitmap: { width: 8, height: 8 },
      source: [0, 0, 8, 8],
      destination: [0, 2, 10, 5],
      protocol: 'kitty',
    })
  })

  test('physically crops a picture clipped by an overflow-hidden ancestor instead of withholding it', async () => {
    expect(await drawnWith({ clipHeight: 2, protocol: 'kitty' })).toEqual({
      bitmap: { width: 8, height: 4 },
      source: [0, 0, 8, 4],
      destination: [0, 2, 10, 2],
      protocol: 'kitty',
    })
  })

  test('crops under an auto request too and keeps native kitty', async () => {
    const drawn = await drawnWith({ clipHeight: 2, protocol: 'auto' })

    expect(drawn?.bitmap).toEqual({ width: 8, height: 4 })
    expect(drawn?.protocol).toBe('kitty')
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
      BUFFER,
    )
    await renderOnce()
    await flush()

    if (seen.node === null) throw new Error('transcript-image never mounted')
    expect(seen.node.effectiveProtocol).toBe('kitty')
  })
})
