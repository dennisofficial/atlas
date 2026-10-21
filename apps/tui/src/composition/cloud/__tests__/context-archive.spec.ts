import { describe, expect, it } from 'vitest'

import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ENoticeTone, type NoticePort, type NoticePost } from '@dltech/atlas-core'
import { captureContextArchive, extractContextArchive } from '@dltech/atlas-harness'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const recordingNotices = (): { posts: NoticePost[]; port: NoticePort } => {
  const posts: NoticePost[] = []
  return {
    posts,
    port: {
      notify: (post) => {
        posts.push(post)
      },
    },
  }
}

const decode = async (archive: Buffer): Promise<Record<string, string>> => {
  const extracted = await extractContextArchive({ archive })
  try {
    const decoded: Record<string, string> = {}
    for (const entry of extracted.entries) {
      decoded[entry.key] = (await readFile(entry.path)).toString('utf8')
    }
    return decoded
  } finally {
    await extracted.cleanup()
  }
}

describe('captureContextArchive', () => {
  it('returns undefined when there is nothing on this machine to carry', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')

    await expect(
      captureContextArchive({ home, atlasHome, notice: recordingNotices().port }),
    ).resolves.toBeUndefined()
  })

  it('carries the user layer alongside the local mcp config', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeFile(join(atlasHome, 'mcp.json'), '{"mcpServers":{}}', 'utf8')
    await writeFile(join(atlasHome, 'ATLAS.md'), '# global instructions', 'utf8')

    const bundle = await captureContextArchive({ home, atlasHome, notice: recordingNotices().port })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(await decode(bundle)).toEqual({
      '.atlas/mcp.json': '{"mcpServers":{}}',
      'user-layer/instructions/.atlas/ATLAS.md': '# global instructions',
    })
  })

  it('preserves the source mtime through the archive, within tar’s one-second granularity', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    const source = join(atlasHome, 'mcp.json')
    await writeFile(source, '{"mcpServers":{}}', 'utf8')
    const sourceMtimeMs = (await stat(source)).mtimeMs

    const bundle = await captureContextArchive({ home, atlasHome, notice: recordingNotices().port })
    if (bundle === undefined) throw new Error('expected a bundle')

    const extracted = await extractContextArchive({ archive: bundle })
    try {
      const entry = extracted.entries.find((candidate) => candidate.key === '.atlas/mcp.json')
      if (entry === undefined) throw new Error('expected the archive to carry mcp.json')
      expect(Math.abs(entry.mtimeMs - sourceMtimeMs)).toBeLessThan(1_000)
    } finally {
      await extracted.cleanup()
    }
  })

  it('warns and returns undefined rather than silently dropping an oversized archive', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeFile(join(atlasHome, 'mcp.json'), crypto.getRandomValues(new Uint8Array(4_096)))

    const { posts, port } = recordingNotices()
    const bundle = await captureContextArchive({ home, atlasHome, maxArchiveBytes: 1_024, notice: port })

    expect(bundle).toBeUndefined()
    const overflow = posts.find((notice) => notice.key === 'context-archive-overflow')
    expect(overflow).toBeDefined()
    expect(overflow?.tone).toBe(ENoticeTone.Warn)
    expect(overflow?.text).toContain('over the')
  })
})
