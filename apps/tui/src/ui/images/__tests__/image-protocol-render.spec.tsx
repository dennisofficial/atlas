import { afterEach, describe, expect, test } from 'bun:test'
import {
  BoxRenderable,
  NativeImage,
  ScrollBoxRenderable,
  type ImageRenderProtocol,
  type OptimizedBuffer,
} from '@opentui/core'
import { createTestRenderer, setRendererCapabilities, type TestRendererSetup } from '@opentui/core/testing'

import { applyTranscriptBounds } from '../../viewport-rows-store'
import { TranscriptImageRenderable } from '../transcript-image'
import { ViewerImageRenderable } from '../viewer-image'

type Kind = typeof TranscriptImageRenderable | typeof ViewerImageRenderable
type Picture = TranscriptImageRenderable | ViewerImageRenderable

const PROTOCOL_ARGUMENT = 11
const BANDS = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0] }
const BAND_ORDER = ['red', 'green', 'blue', 'yellow'] as const
const KITTY_CAPABLE = { kitty_graphics: true }
const KITTY_ABSENT = { kitty_graphics: false }
const heldTermProgram = process.env.TERM_PROGRAM

const useTerminal = (program: string | undefined): void => {
  if (program === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = program
}

afterEach(() => {
  applyTranscriptBounds({ top: 0, rows: 0 })
  useTerminal(heldTermProgram)
})

const bandedImage = (): NativeImage => {
  const pixels = new Uint8Array(16 * 32 * 4)
  for (let y = 0; y < 32; y += 1) {
    const band = BANDS[BAND_ORDER[Math.floor(y / 8)] ?? 'red']
    for (let x = 0; x < 16; x += 1) pixels.set([...band, 255], (y * 16 + x) * 4)
  }
  return NativeImage.fromRgba(pixels, 16, 32)
}

const withScene = async (run: (scene: TestRendererSetup) => Promise<void>): Promise<void> => {
  const scene = await createTestRenderer({ width: 20, height: 20 })
  try {
    await run(scene)
  } finally {
    scene.renderer.destroy()
  }
}

const mountPicture = async (args: {
  scene: TestRendererSetup
  kind: Kind
  protocol: ImageRenderProtocol
  parent?: ScrollBoxRenderable
}): Promise<{ node: Picture; dispose: () => void }> => {
  const image = bandedImage()
  const options = { source: image, protocol: args.protocol, width: 8, height: 8, flexShrink: 0 }
  const node = new args.kind(args.scene.renderer, options)
  ;(args.parent ?? args.scene.renderer.root).add(node)
  await node.loadPromise
  await args.scene.renderOnce()
  return { node, dispose: () => image.dispose() }
}

interface Paintable {
  renderSelf(buffer: OptimizedBuffer): void
}

const forwardedProtocol = (node: Picture): unknown => {
  const calls: unknown[][] = []
  const probe = { drawImage: (...call: unknown[]) => calls.push(call) }
  const paintable = node as unknown as Paintable
  paintable.renderSelf(probe as unknown as OptimizedBuffer)
  return calls.at(-1)?.[PROTOCOL_ARGUMENT]
}

const withPicture = async (args: {
  kind: Kind
  protocol: ImageRenderProtocol
  program: string | undefined
  run: (picture: { scene: TestRendererSetup; node: Picture }) => Promise<void>
}): Promise<void> => {
  useTerminal(args.program)
  await withScene(async (scene) => {
    setRendererCapabilities(scene.renderer, KITTY_CAPABLE)
    const mounted = await mountPicture({ scene, kind: args.kind, protocol: args.protocol })
    try {
      await args.run({ scene, node: mounted.node })
    } finally {
      mounted.dispose()
    }
  })
}

const kinds: Array<[string, Kind]> = [
  ['transcript picture', TranscriptImageRenderable],
  ['viewer picture', ViewerImageRenderable],
]

describe.each(kinds)('a %s handed to the native painter', (_name, kind) => {
  const forwardedFor = async (args: { program: string | undefined; protocol: ImageRenderProtocol }) => {
    const seen: { forwarded: unknown; requested: ImageRenderProtocol | null } = { forwarded: null, requested: null }
    await withPicture({
      kind,
      ...args,
      run: async ({ node }) => {
        seen.forwarded = forwardedProtocol(node)
        seen.requested = node.protocol
      },
    })
    return seen
  }

  test('auto under Warp reaches the native painter as blocks and stays requested as auto', async () => {
    expect(await forwardedFor({ program: 'WarpTerminal', protocol: 'auto' })).toEqual({ forwarded: 'blocks', requested: 'auto' })
  })

  test('auto elsewhere reaches the native painter as the resolved kitty', async () => {
    expect(await forwardedFor({ program: 'iTerm.app', protocol: 'auto' })).toEqual({ forwarded: 'kitty', requested: 'auto' })
  })

  test('an explicit kitty request stays kitty under Warp when the picture is wholly visible', async () => {
    expect(await forwardedFor({ program: 'WarpTerminal', protocol: 'kitty' })).toEqual({ forwarded: 'kitty', requested: 'kitty' })
  })

  test('re-resolves from the retained auto request when terminal or capabilities change', async () => {
    await withPicture({
      kind,
      protocol: 'auto',
      program: 'WarpTerminal',
      run: async ({ scene, node }) => {
        const seen: unknown[] = [forwardedProtocol(node)]
        useTerminal('iTerm.app')
        seen.push(forwardedProtocol(node))
        setRendererCapabilities(scene.renderer, KITTY_ABSENT)
        seen.push(forwardedProtocol(node))
        setRendererCapabilities(scene.renderer, KITTY_CAPABLE)
        seen.push(forwardedProtocol(node))
        useTerminal('WarpTerminal')
        seen.push(forwardedProtocol(node))

        expect(seen).toEqual(['blocks', 'kitty', 'blocks', 'kitty', 'blocks'])
        expect(node.protocol).toBe('auto')
      },
    })
  })

  test('requests no render while repainting an unchanged resolution', async () => {
    await withPicture({
      kind,
      protocol: 'auto',
      program: 'WarpTerminal',
      run: async ({ scene, node }) => {
        const request = node.requestRender.bind(node)
        let requests = 0
        node.requestRender = () => {
          requests += 1
          request()
        }

        for (let paint = 0; paint < 5; paint += 1) {
          forwardedProtocol(node)
          await scene.renderOnce()
        }

        expect(requests).toBe(0)
      },
    })
  })

  test('follows protocol setter transitions after the first paint and keeps the latest request', async () => {
    await withPicture({
      kind,
      protocol: 'auto',
      program: 'WarpTerminal',
      run: async ({ node }) => {
        const seen: Array<[unknown, ImageRenderProtocol]> = [[forwardedProtocol(node), node.protocol]]

        node.protocol = 'kitty'
        seen.push([forwardedProtocol(node), node.protocol])
        node.protocol = undefined
        seen.push([forwardedProtocol(node), node.protocol])
        node.protocol = 'kitty'
        node.protocol = null
        seen.push([forwardedProtocol(node), node.protocol])

        expect(seen).toEqual([
          ['blocks', 'auto'],
          ['kitty', 'kitty'],
          ['blocks', 'auto'],
          ['blocks', 'auto'],
        ])
      },
    })
  })

  test('only forwards sixel when the terminal reports a valid pixel resolution', async () => {
    await withPicture({
      kind,
      protocol: 'sixel',
      program: 'iTerm.app',
      run: async ({ scene, node }) => {
        const reportResolution = (resolution: { width: number; height: number } | null): void => {
          Object.defineProperty(scene.renderer, 'resolution', { value: resolution, configurable: true })
        }
        const seen: unknown[] = [forwardedProtocol(node)]
        reportResolution({ width: 200, height: 400 })
        seen.push(forwardedProtocol(node))
        reportResolution({ width: 0, height: 400 })
        seen.push(forwardedProtocol(node))
        reportResolution({ width: 200, height: 0 })
        seen.push(forwardedProtocol(node))

        expect(seen).toEqual(['blocks', 'sixel', 'blocks', 'blocks'])
      },
    })
  })
})

const VIEWPORT_ROWS = 10
const SPACER_BEFORE = 4
const SPACER_AFTER = 20

type Band = keyof typeof BANDS | 'none'

const bandAt = (args: { scene: TestRendererSetup; row: number }): Band => {
  const first = args.scene.captureSpans().lines[args.row]?.spans[0]
  if (first === undefined) return 'none'
  const painted = first.bg.toInts().slice(0, 3).join()
  return BAND_ORDER.find((band) => BANDS[band].join() === painted) ?? 'none'
}

const scrolledBands = async (args: {
  scene: TestRendererSetup
  protocol: ImageRenderProtocol
  offset: number
}): Promise<{ bands: Band[]; imageHeight: number; dispose: () => void }> => {
  const { scene } = args
  const scroll = new ScrollBoxRenderable(scene.renderer, { width: 20, height: VIEWPORT_ROWS, scrollY: true })
  scene.renderer.root.add(scroll)
  scroll.add(new BoxRenderable(scene.renderer, { height: SPACER_BEFORE, flexShrink: 0 }))
  const kind = TranscriptImageRenderable
  const mounted = await mountPicture({ scene, kind, protocol: args.protocol, parent: scroll })
  scroll.add(new BoxRenderable(scene.renderer, { height: SPACER_AFTER, flexShrink: 0 }))
  await scene.renderOnce()
  applyTranscriptBounds({ top: scroll.viewport.y, rows: scroll.viewport.height })
  scroll.scrollTo(args.offset)
  await scene.renderOnce()
  const bands = Array.from({ length: VIEWPORT_ROWS }, (_, row) => bandAt({ scene, row }))
  return { bands, imageHeight: mounted.node.height, dispose: mounted.dispose }
}

const N: Band = 'none'
const expectedByOffset: Array<[number, Band[]]> = [
  [2, [N, N, 'red', 'red', 'green', 'green', 'blue', 'blue', 'yellow', 'yellow']],
  [0, [N, N, N, N, 'red', 'red', 'green', 'green', 'blue', 'blue']],
  [6, ['green', 'green', 'blue', 'blue', 'yellow', 'yellow', N, N, N, N]],
  [8, ['blue', 'blue', 'yellow', 'yellow', N, N, N, N, N, N]],
  [10, ['yellow', 'yellow', N, N, N, N, N, N, N, N]],
]

describe.each<[ImageRenderProtocol, string | undefined]>([
  ['blocks', undefined],
  ['auto', 'WarpTerminal'],
])('a banded portrait picture in a real scrollbox with protocol %s', (protocol, program) => {
  test.each(expectedByOffset)('at scroll offset %d shows the matching slice at unchanged scale', async (offset, expected) => {
    useTerminal(program)
    await withScene(async (scene) => {
      setRendererCapabilities(scene.renderer, KITTY_CAPABLE)
      const scrolled = await scrolledBands({ scene, protocol, offset })
      try {
        expect(scrolled.imageHeight).toBe(8)
        expect(scrolled.bands).toEqual(expected)
      } finally {
        scrolled.dispose()
      }
    })
  })
})
