import { expect, test } from 'bun:test'
import type { Renderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import React, { act, useState } from 'react'

import type { ToolCall } from '../../../../store'
import { applyTranscriptCovered } from '../../../covered-store'
import { TranscriptImageRenderable } from '../../../images/transcript-image'
import { encodePng } from '../../../images/__tests__/png-fixture'
import { ToolImage } from '../tool-image'

const picture = encodePng({
  width: 16,
  height: 32,
  colourType: 6,
  bytesPerPixel: 4,
  samples: new Uint8Array(16 * 32 * 4).fill(255),
})

const call = {
  callId: 'image-source',
  name: 'read',
  input: { path: '/missing/shot.png' },
  output: { path: '/missing/shot.png', mediaType: 'image/png', width: 16, height: 32, byteLength: picture.length, inlined: true },
  image: { mediaType: 'image/png', data: Buffer.from(picture).toString('base64') },
  settled: true,
  failed: false,
} as unknown as ToolCall

const imageIn = (node: Renderable): TranscriptImageRenderable | null => {
  if (node instanceof TranscriptImageRenderable) return node
  for (const child of node.getChildren()) {
    const image = imageIn(child)
    if (image !== null) return image
  }
  return null
}

test('keeps the decoded image source stable across unrelated React renders', async () => {
  applyTranscriptCovered(false)
  const controls: { handleResize: () => void } = { handleResize: () => undefined }
  function Fixture() {
    const [inner, setInner] = useState(40)
    controls.handleResize = () => setInner((current) => current - 2)
    return <ToolImage call={call} inner={inner} cwd="/missing" />
  }
  const scene = await testRender(<Fixture />, { width: 44, height: 24 })
  try {
    await scene.renderOnce()
    const node = imageIn(scene.renderer.root)
    if (node === null) throw new Error('transcript image was not mounted')
    await node.loadPromise
    await scene.renderOnce()
    const source = node.source
    const decoded = node.image
    expect(decoded).not.toBeNull()
    await act(async () => controls.handleResize())
    await scene.renderOnce()
    expect(node.source).toBe(source)
    expect(node.image).toBe(decoded)
  } finally {
    await act(async () => scene.renderer.destroy())
    applyTranscriptCovered(false)
  }
})
