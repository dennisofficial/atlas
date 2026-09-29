import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { createPathResolver } from '@dltech/atlas-harness'

import { bindPathLinks, unbindPathLinks } from '../../../../composition/path-links'
import { EProseBlock, proseBlocks } from '../blocks'
import { EInline } from '../inline'

function prose(source: string) {
  const block = proseBlocks(source)[0]
  if (block === undefined || block.kind !== EProseBlock.Paragraph) throw new Error('not a paragraph')
  return block.content
}

afterEach(unbindPathLinks)

describe('prose path links end to end', () => {
  it('links a path that exists on disk against the project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'path-link-e2e-'))
    mkdirSync(join(root, 'apps/tui'), { recursive: true })
    writeFileSync(join(root, 'apps/tui/inline.ts'), '')
    bindPathLinks({ resolve: createPathResolver({ root }) })

    const content = prose('the detector lives in apps/tui/inline.ts now')
    const link = content.find((node) => node.kind === EInline.FilePath)
    expect(link).toMatchObject({ path: join(root, 'apps/tui/inline.ts') })
  })

  it('renders a slash-joined phrase as plain text when nothing on disk answers it', () => {
    const root = mkdtempSync(join(tmpdir(), 'path-link-e2e-empty-'))
    bindPathLinks({ resolve: createPathResolver({ root }) })

    const content = prose('can we implement the same foundation/structure/etc to services?')
    expect(content.every((node) => node.kind === EInline.Text)).toBe(true)
  })
})
