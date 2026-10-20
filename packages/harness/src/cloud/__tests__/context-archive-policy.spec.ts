import { describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { ENoticeTone, type NoticePort, type NoticePost } from '@dltech/atlas-core'

import { extractContextArchive } from '../context-archive'
import { captureContextArchive } from '../context-archive-policy'
import { resolveUserLayerRoots, scanUserLayer, userLayerArchiveKey } from '../context-archive-user-layer'

type Layer = { home: string; atlasHome: string; projectDirectory: string }

const freshDirectory = (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const freshLayer = async (): Promise<Layer> => ({
  home: await freshDirectory('atlas-archive-home-'),
  atlasHome: await freshDirectory('atlas-archive-atlashome-'),
  projectDirectory: await freshDirectory('atlas-archive-project-'),
})

const put = async (args: { path: string; content: string | Uint8Array }): Promise<void> => {
  await mkdir(dirname(args.path), { recursive: true })
  await writeFile(args.path, args.content)
}

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

const populate = async (layer: Layer): Promise<void> => {
  await put({ path: join(layer.atlasHome, 'mcp.json'), content: '{"mcpServers":{}}' })
  await put({ path: join(layer.atlasHome, 'skills', 'x', 'SKILL.md'), content: 'skill x' })
  await put({ path: join(layer.home, '.agents', 'skills', 'y', 'SKILL.md'), content: 'skill y' })
  await put({ path: join(layer.home, '.claude', 'skills', 'z', 'SKILL.md'), content: 'skill z' })
  await put({ path: join(layer.atlasHome, 'ATLAS.md'), content: '# global' })
  await put({ path: join(layer.projectDirectory, 'CLAUDE.local.md'), content: '# local' })
}

const capture = (args: { layer: Layer; notice: NoticePort; maxArchiveBytes?: number }) =>
  captureContextArchive({ ...args.layer, notice: args.notice, maxArchiveBytes: args.maxArchiveBytes })

describe('captureContextArchive user layer', () => {
  it('carries skills of every flavour, instructions and mcp.json under their archive keys', async () => {
    const layer = await freshLayer()
    await populate(layer)

    const bundle = await capture({ layer, notice: recordingNotices().port })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(await decode(bundle)).toEqual({
      '.atlas/mcp.json': '{"mcpServers":{}}',
      'user-layer/skills/.atlas/x/SKILL.md': 'skill x',
      'user-layer/skills/.agents/y/SKILL.md': 'skill y',
      'user-layer/skills/.claude/z/SKILL.md': 'skill z',
      'user-layer/instructions/.atlas/ATLAS.md': '# global',
      'user-layer/instructions/project/CLAUDE.local.md': '# local',
    })
  })

  it('carries exactly the files the sync engine scans, plus mcp.json', async () => {
    const layer = await freshLayer()
    await populate(layer)

    const bundle = await capture({ layer, notice: recordingNotices().port })
    if (bundle === undefined) throw new Error('expected a bundle')

    const scanned = await scanUserLayer(await resolveUserLayerRoots(layer))
    const expected = [...scanned.map(userLayerArchiveKey), '.atlas/mcp.json'].sort()
    expect(Object.keys(await decode(bundle)).sort()).toEqual(expected)
    expect(scanned.length).toBeGreaterThan(0)
  })

  it('returns undefined when the layer is empty and there is no mcp.json', async () => {
    const layer = await freshLayer()

    await expect(capture({ layer, notice: recordingNotices().port })).resolves.toBeUndefined()
  })

  it('skips a file over the sync cap, warns under the sync engine’s notice key, and archives the rest', async () => {
    const layer = await freshLayer()
    await populate(layer)
    await put({ path: join(layer.atlasHome, 'skills', 'big', 'SKILL.md'), content: 'a'.repeat(3_000_001) })

    const { posts, port } = recordingNotices()
    const bundle = await capture({ layer, notice: port })
    if (bundle === undefined) throw new Error('expected a bundle')

    const keys = Object.keys(await decode(bundle))
    expect(keys).not.toContain('user-layer/skills/.atlas/big/SKILL.md')
    expect(keys).toContain('user-layer/skills/.atlas/x/SKILL.md')
    const oversize = posts.find((post) => post.key === 'user-layer-oversize:skills/.atlas/big/SKILL.md')
    expect(oversize?.tone).toBe(ENoticeTone.Warn)
    expect(oversize?.text).toBe(
      'not carrying skills/.atlas/big/SKILL.md to the cloud session: 3.0 MB is over the 3.0 MB limit',
    )
  })

  it('skips files that are not valid UTF-8 without a notice', async () => {
    const layer = await freshLayer()
    await populate(layer)
    await put({ path: join(layer.atlasHome, 'skills', 'bin', 'blob.dat'), content: new Uint8Array([0xff, 0xfe, 0xfd]) })

    const { posts, port } = recordingNotices()
    const bundle = await capture({ layer, notice: port })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(Object.keys(await decode(bundle))).not.toContain('user-layer/skills/.atlas/bin/blob.dat')
    expect(posts).toEqual([])
  })

  it('warns and returns undefined when the archive is over the ceiling', async () => {
    const layer = await freshLayer()
    await populate(layer)
    await put({ path: join(layer.atlasHome, 'skills', 'x', 'noise.md'), content: crypto.randomUUID().repeat(300) })

    const { posts, port } = recordingNotices()
    const bundle = await capture({ layer, notice: port, maxArchiveBytes: 64 })

    expect(bundle).toBeUndefined()
    const overflow = posts.find((post) => post.key === 'context-archive-overflow')
    expect(overflow?.tone).toBe(ENoticeTone.Warn)
    expect(overflow?.text).toContain('over the')
    expect(overflow?.text).toContain('skills and instructions')
  })

  it('does not carry conflict copies or .DS_Store', async () => {
    const layer = await freshLayer()
    await populate(layer)
    await put({ path: join(layer.atlasHome, 'ATLAS.conflict-abc.md'), content: 'stale' })
    await put({ path: join(layer.atlasHome, 'skills', 'x', 'SKILL.conflict-abc.md'), content: 'stale' })
    await put({ path: join(layer.atlasHome, 'skills', 'x', '.DS_Store'), content: 'junk' })

    const bundle = await capture({ layer, notice: recordingNotices().port })
    if (bundle === undefined) throw new Error('expected a bundle')

    const keys = Object.keys(await decode(bundle))
    expect(keys.filter((key) => key.includes('.conflict-') || key.endsWith('.DS_Store'))).toEqual([])
  })
})
