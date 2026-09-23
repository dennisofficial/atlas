import { beforeEach, describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { extractContextArchive, memoryDirectoriesFor } from '@dltech/atlas-harness'

import { captureContextArchive } from '../context-archive'
import { currentNotices, dismissNotice, ENoticeTone } from '../../../ui/notice-store'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

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

const writeUnder = async (args: { directory: string; name: string; content: string }): Promise<void> => {
  const path = join(args.directory, args.name)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, args.content, 'utf8')
}

beforeEach(() => {
  dismissNotice()
})

describe('captureContextArchive', () => {
  it('returns undefined when there is nothing on this machine to carry', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')

    await expect(captureContextArchive({ home, atlasHome })).resolves.toBeUndefined()
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

    const bundle = await captureContextArchive({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(await decode(bundle)).toEqual({
      '.atlas/skills/review/SKILL.md': '# review',
      '.agents/skills/explore/SKILL.md': '# explore',
    })
  })

  it('carries the global instructions file and the local mcp config', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeFile(join(atlasHome, 'ATLAS.md'), '# global instructions', 'utf8')
    await writeFile(join(atlasHome, 'mcp.json'), '{"mcpServers":{}}', 'utf8')

    const bundle = await captureContextArchive({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(await decode(bundle)).toEqual({
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

    const bundle = await captureContextArchive({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(await decode(bundle)).toEqual({
      '.atlas/memory/MEMORY.md': '# user memory',
      '.atlas/memory/topic.md': '# a topic',
    })
  })

  it('leaves project memory and project locals out when no cwd is given', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    await writeFile(join(atlasHome, 'ATLAS.md'), '# global instructions', 'utf8')

    const bundle = await captureContextArchive({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(Object.keys(await decode(bundle))).toEqual(['.atlas/ATLAS.md'])
  })

  it('carries this repo’s project memory, keyed by the Mac-side project memory directory', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    const cwd = await freshDirectory('atlas-context-cwd-')
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: cwd }).project
    await writeUnder({ directory: projectMemory, name: 'MEMORY.md', content: '# project memory' })

    const bundle = await captureContextArchive({ home, atlasHome, cwd })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(await decode(bundle)).toEqual({ 'project-memory/MEMORY.md': '# project memory' })
  })

  it('carries project memory from the identity-keyed directory a repo with a remote resolves to', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    const cwd = await freshDirectory('atlas-context-cwd-')
    const init = Bun.spawnSync(['git', 'init', '--initial-branch=main'], { cwd })
    if (init.exitCode !== 0) throw new Error('git init failed')
    const remote = Bun.spawnSync(
      ['git', 'remote', 'add', 'origin', 'git@github.com:org/atlas.git'],
      { cwd },
    )
    if (remote.exitCode !== 0) throw new Error('git remote add failed')
    await writeUnder({
      directory: join(atlasHome, 'projects', 'github.com', 'org', 'atlas', 'memory'),
      name: 'MEMORY.md',
      content: '# identity-keyed project memory',
    })

    const bundle = await captureContextArchive({ home, atlasHome, cwd })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(await decode(bundle)).toEqual({
      'project-memory/MEMORY.md': '# identity-keyed project memory',
    })
  })

  it('carries gitignored *.local.md instruction files at the repo root, but nothing nested', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    const cwd = await freshDirectory('atlas-context-cwd-')
    await writeFile(join(cwd, 'ATLAS.local.md'), '# only on this machine', 'utf8')
    await mkdir(join(cwd, 'nested'), { recursive: true })
    await writeFile(join(cwd, 'nested', 'CLAUDE.local.md'), '# not at the root', 'utf8')
    await writeFile(join(cwd, 'README.md'), '# not local', 'utf8')

    const bundle = await captureContextArchive({ home, atlasHome, cwd })
    if (bundle === undefined) throw new Error('expected a bundle')

    expect(await decode(bundle)).toEqual({ 'project/ATLAS.local.md': '# only on this machine' })
  })

  it('preserves the source mtime through the archive, within tar’s one-second granularity', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    const source = join(atlasHome, 'ATLAS.md')
    await writeFile(source, '# global instructions', 'utf8')
    const sourceMtimeMs = (await stat(source)).mtimeMs

    const bundle = await captureContextArchive({ home, atlasHome })
    if (bundle === undefined) throw new Error('expected a bundle')

    const extracted = await extractContextArchive({ archive: bundle })
    try {
      const entry = extracted.entries.find((candidate) => candidate.key === '.atlas/ATLAS.md')
      if (entry === undefined) throw new Error('expected the archive to carry ATLAS.md')
      expect(Math.abs(entry.mtimeMs - sourceMtimeMs)).toBeLessThan(1_000)
    } finally {
      await extracted.cleanup()
    }
  })

  it('warns and returns undefined rather than silently dropping an oversized archive', async () => {
    const home = await freshDirectory('atlas-context-home-')
    const atlasHome = await freshDirectory('atlas-context-atlashome-')
    // Random bytes so gzip cannot compress the payload back under the tiny test ceiling.
    await writeFile(join(atlasHome, 'ATLAS.md'), crypto.getRandomValues(new Uint8Array(4_096)))

    const bundle = await captureContextArchive({ home, atlasHome, maxArchiveBytes: 1_024 })

    expect(bundle).toBeUndefined()
    const overflow = currentNotices().find((notice) => notice.key === 'context-archive-overflow')
    expect(overflow).toBeDefined()
    expect(overflow?.tone).toBe(ENoticeTone.Warn)
    expect(overflow?.text).toContain('over the')
  })
})
