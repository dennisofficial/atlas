import { BoxRenderable, NativeImage } from '@opentui/core'
import { createTestRenderer, setRendererCapabilities } from '@opentui/core/testing'

import { kittyImageTransportOf } from '../../../composition/terminal-image-transport'
import { TranscriptImageRenderable } from '../transcript-image'

process.env.TERM_PROGRAM = 'WarpTerminal'
const opacity = Number(process.argv[2] ?? 1)
const setup = await createTestRenderer({
  width: 20,
  height: 20,
  stdout: process.stdout,
  bufferedOutput: 'stdout',
  kittyImageTransport: kittyImageTransportOf({ env: process.env }),
  useThread: false,
})
setRendererCapabilities(setup.renderer, { kitty_graphics: true })
Object.defineProperty(setup.renderer, 'resolution', {
  value: { width: 160, height: 320 },
  configurable: true,
})
const source = NativeImage.fromRgba(new Uint8Array(128 * 256 * 4).fill(255), 128, 256)
const parent = new BoxRenderable(setup.renderer, { width: 20, height: 20, opacity })
setup.renderer.root.add(parent)
const image = new TranscriptImageRenderable(setup.renderer, {
  source,
  protocol: 'auto',
  width: 8,
  height: 8,
  flexShrink: 0,
})
parent.add(image)
try {
  await image.loadPromise
  await setup.renderOnce()
  image.translateY = -4
  await setup.renderOnce()
  for (let frame = 0; frame < 3; frame += 1) await setup.renderOnce()
} finally {
  setup.renderer.destroy()
  source.dispose()
}
