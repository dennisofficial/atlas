import { describe, expect, it } from 'bun:test'
import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'

import { frameOf } from '../../../__tests__/transcript-fixture'
import { grammarsReady } from '../../../markdown/__tests__/harness'
import { UserBlock } from '../user-block'

await grammarsReady()

const IMAGE: Attachment = {
  id: 'image:0',
  name: 'paste-1.png',
  mediaType: 'image/png',
  size: 3072,
  content: { store: EAttachmentStore.Inline, data: 'A'.repeat(4096) },
  image: { width: 560, height: 280 },
}

const ATTACHED = {
  skills: ['implement', 'tdd'],
  files: ['apps/tui/src/ui/components/blocks/user-block.tsx'],
  attachments: [IMAGE],
} as const

const rowWith = (frame: string, text: string): number =>
  frame.split('\n').findIndex((line) => line.includes(text))

describe('UserBlock attachments', () => {
  it('carries skills, files and images as chips below the message text', async () => {
    const frame = await frameOf(
      <UserBlock said={['why does this fail?']} width={100} {...ATTACHED} />,
      100,
    )

    expect(frame).toContain('why does this fail?')
    expect(frame).toContain('◆ implement')
    expect(frame).toContain('◆ tdd')
    expect(frame).toContain('⬚ user-block.tsx')
    expect(frame).toContain('▣ paste-1.png · 560×280 · ~200 tokens')
  })

  it('keeps every chip inside the slab, below the said text', async () => {
    const frame = await frameOf(
      <UserBlock said={['why does this fail?']} width={100} {...ATTACHED} />,
      100,
    )

    const said = rowWith(frame, 'why does this fail?')
    expect(said).toBeGreaterThanOrEqual(0)
    for (const chip of ['◆ implement', '⬚ user-block.tsx', '▣ paste-1.png']) {
      expect(rowWith(frame, chip)).toBeGreaterThan(said)
    }
  })

  it('labels a directory chip with its name despite the trailing slash', async () => {
    const frame = await frameOf(
      <UserBlock said={['look at this']} width={100} files={['~/Developer/comp-v2/']} />,
      100,
    )

    expect(frame).toContain('⬚ comp-v2')
  })

  it('drops the old continuation glyph entirely', async () => {
    const frame = await frameOf(
      <UserBlock said={['why does this fail?']} width={100} {...ATTACHED} />,
      100,
    )

    expect(frame).not.toContain('⎿')
  })

  it('wraps the chips rather than clipping them on a narrow terminal', async () => {
    const frame = await frameOf(
      <UserBlock said={['why does this fail?']} width={40} {...ATTACHED} />,
      40,
    )

    expect(frame).toContain('◆ implement')
    expect(frame).toContain('⬚ user-block.tsx')
    expect(frame).toContain('▣ paste-1.png')
  })

  it('draws no band when nothing rode along', async () => {
    const frame = await frameOf(<UserBlock said={['plain message']} width={100} />, 100)

    expect(frame).toContain('plain message')
    expect(frame).not.toContain('◆')
    expect(frame).not.toContain('⬚')
    expect(frame).not.toContain('▣')
  })

  it('still carries the take-back badge when attachments are present', async () => {
    const frame = await frameOf(
      <UserBlock said={['why does this fail?']} width={100} takeBack {...ATTACHED} />,
      100,
    )

    expect(frame).toContain('↑ to edit')
    expect(frame).toContain('◆ implement')
  })
})
