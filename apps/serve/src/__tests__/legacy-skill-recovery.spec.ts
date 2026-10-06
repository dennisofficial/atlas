import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mkdir, readdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'

import {
  archiveOf,
  LEGACY_STAMP,
  makeScratch,
  PNG_BYTES,
  recover,
  stampOf,
  writeLegacyStamp,
  type Scratch,
} from './legacy-skill-fixture'

let scratch: Scratch

beforeEach(async () => {
  scratch = await makeScratch()
})

afterEach(async () => {
  await scratch.cleanup()
})

const lifted = {
  '.agents/skills/handoff/SKILL.md': '# handoff',
  '.agents/skills/handoff/assets/icon.png': PNG_BYTES,
  '.claude/skills/review/SKILL.md': '# review',
  '.atlas/skills/atlas-skill/SKILL.md': '# archived atlas skill',
  '.atlas/memory/MEMORY.md': '# stale archived memory',
  '.atlas/ATLAS.md': '# stale archived instructions',
  '.atlas/mcp.json': '{"stale":true}',
  'project-memory/MEMORY.md': '# stale project memory',
  'project/ATLAS.local.md': '# stale project instructions',
}

describe('legacy-stamp skill recovery from a real archive', () => {
  it('restores compatibility skills and binary assets without replaying durable context', async () => {
    const archive = await archiveOf({ scratch, entries: lifted })
    await writeLegacyStamp({ scratch })
    await scratch.put({ path: join(scratch.atlasHome, 'memory', 'MEMORY.md'), content: '# live memory' })
    await scratch.put({ path: join(scratch.atlasHome, 'ATLAS.md'), content: '# live instructions' })
    await scratch.put({ path: join(scratch.atlasHome, 'mcp.json'), content: '{"live":true}' })
    await scratch.put({ path: join(scratch.atlasHome, 'skills', 'atlas-skill', 'SKILL.md'), content: '# live atlas skill' })

    const readiness = await recover({ scratch, archive })

    expect(readiness).toEqual({ written: 3, failed: null, ...LEGACY_STAMP })
    expect(await scratch.readText(join(scratch.atlasHome, '.agents/skills/handoff/SKILL.md'))).toBe('# handoff')
    expect(await Bun.file(join(scratch.atlasHome, '.agents/skills/handoff/assets/icon.png')).bytes()).toEqual(
      new Uint8Array(PNG_BYTES),
    )
    expect(await scratch.readText(join(scratch.atlasHome, '.claude/skills/review/SKILL.md'))).toBe('# review')
    expect(await scratch.readText(join(scratch.atlasHome, 'memory', 'MEMORY.md'))).toBe('# live memory')
    expect(await scratch.readText(join(scratch.atlasHome, 'ATLAS.md'))).toBe('# live instructions')
    expect(await scratch.readText(join(scratch.atlasHome, 'mcp.json'))).toBe('{"live":true}')
    expect(await scratch.readText(join(scratch.atlasHome, 'skills/atlas-skill/SKILL.md'))).toBe(
      '# live atlas skill',
    )
    expect(await readdir(scratch.cwd).catch(() => [])).toEqual([])
    expect(await stampOf(scratch)).toEqual({ ...LEGACY_STAMP, skillLayout: 'persistent-v1' })
  })

  it('does not replay on the next boot once the layout is stamped', async () => {
    const archive = await archiveOf({ scratch, entries: lifted })
    await writeLegacyStamp({ scratch })
    await recover({ scratch, archive })
    let specCalls = 0

    const second = await recover({ scratch, archive, onSpec: () => void (specCalls += 1) })

    expect(second).toEqual({ written: 0, failed: null, ...LEGACY_STAMP })
    expect(specCalls).toBe(0)
  })

  it('imports surviving home roots, lets them win over the archive, and keeps an empty root deleted', async () => {
    const archive = await archiveOf({ scratch, entries: lifted })
    await writeLegacyStamp({ scratch })
    await scratch.put({ path: join(scratch.legacyHome, '.agents/skills/handoff/SKILL.md'), content: '# edited at runtime' })
    await scratch.put({ path: join(scratch.legacyHome, '.agents/skills/added/SKILL.md'), content: '# added at runtime' })
    await scratch.put({ path: join(scratch.legacyHome, '.agents/skills/handoff/assets/icon.png'), content: PNG_BYTES })
    await mkdir(join(scratch.legacyHome, '.claude/skills'), { recursive: true })

    const readiness = await recover({ scratch, archive })

    expect(readiness.failed).toBeNull()
    expect(await scratch.readText(join(scratch.atlasHome, '.agents/skills/handoff/SKILL.md'))).toBe(
      '# edited at runtime',
    )
    expect(await scratch.readText(join(scratch.atlasHome, '.agents/skills/added/SKILL.md'))).toBe(
      '# added at runtime',
    )
    expect(await Bun.file(join(scratch.atlasHome, '.claude/skills/review/SKILL.md')).exists()).toBe(false)
    expect((await stampOf(scratch)).skillLayout).toBe('persistent-v1')
  })

  it('never fetches the archive when both home roots survive', async () => {
    await writeLegacyStamp({ scratch })
    await scratch.put({ path: join(scratch.legacyHome, '.agents/skills/a/SKILL.md'), content: '# a' })
    await scratch.put({ path: join(scratch.legacyHome, '.claude/skills/b/SKILL.md'), content: '# b' })
    let archiveCalls = 0

    const readiness = await recover({
      scratch,
      archive: async () => {
        archiveCalls += 1
        return null
      },
    })

    expect(readiness).toEqual({ written: 2, failed: null, ...LEGACY_STAMP })
    expect(archiveCalls).toBe(0)
    expect((await stampOf(scratch)).skillLayout).toBe('persistent-v1')
  })

  it('keeps an existing persistent file instead of overwriting it', async () => {
    const archive = await archiveOf({ scratch, entries: lifted })
    await writeLegacyStamp({ scratch })
    await scratch.put({ path: join(scratch.atlasHome, '.agents/skills/handoff/SKILL.md'), content: '# newer persistent' })

    const readiness = await recover({ scratch, archive })

    expect(readiness.written).toBe(2)
    expect(await scratch.readText(join(scratch.atlasHome, '.agents/skills/handoff/SKILL.md'))).toBe(
      '# newer persistent',
    )
    expect(await scratch.readText(join(scratch.atlasHome, '.claude/skills/review/SKILL.md'))).toBe('# review')
  })

  it('follows a skill symlink and survives a symlink cycle', async () => {
    await writeLegacyStamp({ scratch })
    await scratch.put({ path: join(scratch.root, 'shared/linked/SKILL.md'), content: '# linked' })
    const agentSkills = join(scratch.legacyHome, '.agents/skills')
    await mkdir(join(scratch.legacyHome, '.claude/skills'), { recursive: true })
    await mkdir(agentSkills, { recursive: true })
    await symlink(join(scratch.root, 'shared/linked'), join(agentSkills, 'linked'))
    await symlink(agentSkills, join(agentSkills, 'loop'))
    await symlink('self', join(agentSkills, 'self'))

    const readiness = await recover({ scratch })

    expect(readiness).toEqual({ written: 1, failed: null, ...LEGACY_STAMP })
    expect(await scratch.readText(join(scratch.atlasHome, '.agents/skills/linked/SKILL.md'))).toBe('# linked')
  })
})
