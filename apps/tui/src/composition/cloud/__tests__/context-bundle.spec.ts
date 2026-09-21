import { beforeEach, describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MAX_CONTEXT_BUNDLE_BYTES, memoryDirectoriesFor } from '@dltech/atlas-harness'

import { captureContextBundle } from '../context-bundle'
import { currentNotices, dismissNotice, ENoticeTone } from '../../../ui/notice-store'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const decode = (bundle: string): Record<string, string> => {
  const entries = JSON.parse(bundle) as Record<string, string>
  return Object.fromEntries(
    Object.entries(entries).map(([path, base64]) => [path, Buffer.from(base64, 'base64').toString('utf8')]),
  )
}

const writeUnder = async (args: { directory: string; name: string; content: string }): Promise<void> => {
  const path = join(args.directory, args.name)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, args.content, 'utf8')
}

beforeEach(() => {
  dismissNotice()
})

describe('captureContextBundle', () => {
  it('returns undefined when there is nothing on this machine to carry', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')

    await expect(captureContextBundle({ home, atlasHome })).resolves.toBeUndefined()
  })

  it('carries the operator’s user-level skill roots', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeUnder({
      directory: join(atlasHome, 'skills'),
      name: 'review/SKILL.md',
      content: '# review',
    })
    await writeUnder({
      directory: join(home, '.agents', 'skills'),
      name: 'explore/SKILL.md',
      content: '# explore',
    })

    const bundle = await captureContextBundle({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(decode(bundle)).toEqual({
      '.atlas/skills/review/SKILL.md': '# review',
      '.agents/skills/explore/SKILL.md': '# explore',
    })
  })

  it('carries the global instructions file and the local mcp config', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeFile(join(atlasHome, 'ATLAS.md'), '# global instructions', 'utf8')
    await writeFile(join(atlasHome, 'mcp.json'), '{"mcpServers":{}}', 'utf8')

    const bundle = await captureContextBundle({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(decode(bundle)).toEqual({
      '.atlas/ATLAS.md': '# global instructions',
      '.atlas/mcp.json': '{"mcpServers":{}}',
    })
  })

  it('carries the flat user memory files, but not another repo’s project memory nested beneath them', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'MEMORY.md', content: '# user memory' })
    await writeUnder({ directory: join(atlasHome, 'memory'), name: 'topic.md', content: '# a topic' })
    await writeUnder({
      directory: join(atlasHome, 'memory'),
      name: 'projects/some-other-repo/memory/MEMORY.md',
      content: '# someone else’s project memory',
    })

    const bundle = await captureContextBundle({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(decode(bundle)).toEqual({
      '.atlas/memory/MEMORY.md': '# user memory',
      '.atlas/memory/topic.md': '# a topic',
    })
  })

  it('leaves project memory and project locals out when no cwd is given', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeFile(join(atlasHome, 'ATLAS.md'), '# global instructions', 'utf8')

    const bundle = await captureContextBundle({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(Object.keys(decode(bundle))).toEqual(['.atlas/ATLAS.md'])
  })

  it('carries this repo’s project memory, keyed by the Mac-side project memory directory', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    const cwd = await freshDirectory('atlas-context-cwd-')
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project
    await writeUnder({ directory: projectMemory, name: 'MEMORY.md', content: '# project memory' })

    const bundle = await captureContextBundle({ home, atlasHome, cwd })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(decode(bundle)).toEqual({ 'project-memory/MEMORY.md': '# project memory' })
  })

  it('carries gitignored *.local.md instruction files at the repo root, but nothing nested', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    const cwd = await freshDirectory('atlas-context-cwd-')
    await writeFile(join(cwd, 'ATLAS.local.md'), '# only on this machine', 'utf8')
    await mkdir(join(cwd, 'nested'), { recursive: true })
    await writeFile(join(cwd, 'nested', 'CLAUDE.local.md'), '# not at the root', 'utf8')
    await writeFile(join(cwd, 'README.md'), '# not local', 'utf8')

    const bundle = await captureContextBundle({ home, atlasHome, cwd })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(decode(bundle)).toEqual({ 'project/ATLAS.local.md': '# only on this machine' })
  })

  it('warns and returns undefined rather than silently dropping an oversized bundle', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeFile(join(atlasHome, 'ATLAS.md'), Buffer.alloc(MAX_CONTEXT_BUNDLE_BYTES + 1, 'x'))

    const bundle = await captureContextBundle({ home, atlasHome })

    expect(bundle).toBeUndefined()
    const overflow = currentNotices().find((notice) => notice.key === 'context-bundle-overflow')
    expect(overflow).toBeDefined()
    expect(overflow?.tone).toBe(ENoticeTone.Warn)
    expect(overflow?.text).toContain('over the')
  })
})
