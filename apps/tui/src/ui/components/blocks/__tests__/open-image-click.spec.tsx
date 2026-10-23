import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import type { SaidImage } from '@dltech/atlas-core'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ToolCall } from '../../../../store'
import { applyTranscriptCovered } from '../../../covered-store'
import { encodePng } from '../../../images/__tests__/png-fixture'
import { grammarsReady } from '../../../markdown/__tests__/harness'
import type { OpenableImage } from '../../../open-image'
import { applyTranscriptRows } from '../../../viewport-rows-store'
import { ToolImage } from '../tool-image'
import { UserBlock } from '../user-block'

await grammarsReady()

const directory = mkdtempSync(join(tmpdir(), 'atlas-open-click-'))

afterAll(() => rmSync(directory, { recursive: true, force: true }))

beforeEach(() => {
  applyTranscriptRows(24)
  applyTranscriptCovered(false)
})

const writePng = (): string => {
  const rgba = new Uint8Array(32 * 32 * 4).fill(200)
  const path = join(directory, 'shot.png')
  writeFileSync(
    path,
    encodePng({
      width: 32,
      height: 32,
      colourType: 6,
      bytesPerPixel: 4,
      samples: rgba,
    }),
  )
  return path
}

const readCall = (path: string): ToolCall =>
  ({
    callId: 'call-1',
    name: 'read',
    input: { path },
    output: {
      path,
      mediaType: 'image/png',
      width: 32,
      height: 32,
      byteLength: 1024,
      inlined: true,
    },
    settled: true,
    failed: false,
  }) as unknown as ToolCall

const settle = async (flush: () => Promise<void>): Promise<void> => {
  for (let pass = 0; pass < 8; pass += 1) {
    await Bun.sleep(1)
    await flush()
  }
}

describe('opening an image from the transcript', () => {
  test('a click on the tool image opens it, a click on its header does not', async () => {
    const path = writePng()
    const opened: OpenableImage[] = []
    const { renderOnce, flush, captureCharFrame, mockMouse, renderer } = await testRender(
      <ToolImage
        call={readCall(path)}
        inner={40}
        cwd={directory}
        onOpenImage={(image) => {
          opened.push(image)
          return true
        }}
      />,
      { width: 44, height: 20 },
    )
    await renderOnce()
    await settle(flush)

    const lines = captureCharFrame().split('\n')
    const header = lines.findIndex((line) => line.includes('shot.png'))
    const row = lines.findIndex((line) => line.includes('█'))
    expect(row).toBeGreaterThan(header)

    await mockMouse.click(2, header)
    await flush()
    expect(opened).toEqual([])

    await mockMouse.click(lines[row]?.indexOf('█') ?? 0, row)
    await flush()
    expect(opened).toEqual([{ path, mediaType: 'image/png', data: null }])
    renderer.destroy()
  })

  test('a click on an image chip opens it, a click on a skill chip does not', async () => {
    const image: SaidImage = {
      path: '/remote/paste-1.png',
      mediaType: 'image/png',
      data: 'AAAA',
      width: 10,
      height: 10,
    }
    const opened: OpenableImage[] = []
    const { renderOnce, flush, captureCharFrame, mockMouse, renderer } = await testRender(
      <UserBlock
        said={['look']}
        width={80}
        skills={['tdd']}
        images={[image]}
        onOpenImage={(picked) => {
          opened.push(picked)
          return true
        }}
      />,
      { width: 80, height: 20 },
    )
    await renderOnce()
    await settle(flush)

    const lines = captureCharFrame().split('\n')
    const skillRow = lines.findIndex((line) => line.includes('◆ tdd'))
    const imageRow = lines.findIndex((line) => line.includes('▣ paste-1.png'))

    await mockMouse.click((lines[skillRow]?.indexOf('tdd') ?? 0) + 1, skillRow)
    await flush()
    expect(opened).toEqual([])

    await mockMouse.click((lines[imageRow]?.indexOf('paste-1') ?? 0) + 1, imageRow)
    await flush()
    expect(opened).toEqual([{ path: image.path, mediaType: 'image/png', data: 'AAAA' }])
    renderer.destroy()
  })
})
