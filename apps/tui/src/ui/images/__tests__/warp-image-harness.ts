import {
  NativeImage,
  type ImageRenderProtocol,
  type OptimizedBuffer,
  type Renderable,
} from '@opentui/core'
import { createTestRenderer, setRendererCapabilities, type TestRendererSetup } from '@opentui/core/testing'

import { TranscriptImageRenderable } from '../transcript-image'
import { ViewerImageRenderable } from '../viewer-image'

export type Kind = typeof TranscriptImageRenderable | typeof ViewerImageRenderable
export type Picture = TranscriptImageRenderable | ViewerImageRenderable

export const BANDS = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0] }
export type Band = keyof typeof BANDS
export const BAND_ORDER: readonly Band[] = ['red', 'green', 'blue', 'yellow']
export const WARP = 'WarpTerminal'
const heldTermProgram = process.env.TERM_PROGRAM

export const restoreTermProgram = (): void => {
  if (heldTermProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = heldTermProgram
}

export const bandedImage = (order: readonly Band[] = BAND_ORDER): NativeImage => {
  const pixels = new Uint8Array(16 * 32 * 4)
  for (let y = 0; y < 32; y += 1) {
    const band = BANDS[order[Math.floor(y / 8)] ?? 'red']
    for (let x = 0; x < 16; x += 1) pixels.set([...band, 255], (y * 16 + x) * 4)
  }
  return NativeImage.fromRgba(pixels, 16, 32)
}

type Draw = {
  image: NativeImage
  destination: number[]
  pixels: number[]
  source: number[]
  protocol: unknown
}

export const draw = (args: { scene: TestRendererSetup; node: Picture }): Draw | null => {
  const calls: unknown[][] = []
  const { width, height } = args.scene.renderer.nextRenderBuffer
  const probe = {
    width,
    height,
    drawImage: (...call: unknown[]) => {
      calls.push(call)
      return true
    },
  }
  const paintable = args.node as unknown as { renderSelf(buffer: OptimizedBuffer): void }
  paintable.renderSelf(probe as unknown as OptimizedBuffer)
  const call = calls.at(-1)
  if (call === undefined) return null
  const numbers = (indexes: number[]): number[] => indexes.map((index) => Number(call[index]))
  return {
    image: call[0] as NativeImage,
    destination: numbers([1, 2, 3, 4]),
    pixels: numbers([5, 6]),
    source: numbers([7, 8, 9, 10]),
    protocol: call[11],
  }
}

export const bandsOf = (image: NativeImage): Band[] => {
  const { data, width, height } = image.raw()
  const seen: Band[] = []
  for (let row = 0; row < height; row += 1) {
    const at = row * width * 4
    const painted = Array.from(data.subarray(at, at + 3)).join()
    const band = BAND_ORDER.find((name) => BANDS[name].join() === painted)
    if (band !== undefined && seen.at(-1) !== band) seen.push(band)
  }
  return seen
}

export const withPicture = async (args: {
  kind: Kind
  program?: string | undefined
  protocol?: ImageRenderProtocol
  image?: NativeImage
  parentOf?: (scene: TestRendererSetup) => Renderable
  run: (picture: { scene: TestRendererSetup; node: Picture }) => Promise<void>
}): Promise<void> => {
  const program = 'program' in args ? args.program : WARP
  if (program === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = program
  const image = args.image ?? bandedImage()
  const scene = await createTestRenderer({ width: 20, height: 20 })
  try {
    setRendererCapabilities(scene.renderer, { kitty_graphics: true })
    const parent = args.parentOf?.(scene) ?? scene.renderer.root
    const node = new args.kind(scene.renderer, {
      source: image,
      protocol: args.protocol ?? 'auto',
      width: 8,
      height: 8,
      flexShrink: 0,
    })
    parent.add(node)
    await node.loadPromise
    await scene.renderOnce()
    await args.run({ scene, node })
  } finally {
    scene.renderer.destroy()
    image.dispose()
  }
}

export const translate = async (args: { scene: TestRendererSetup; node: Picture; y: number }) => {
  args.node.translateY = args.y
  await args.scene.renderOnce()
  return draw(args)
}
