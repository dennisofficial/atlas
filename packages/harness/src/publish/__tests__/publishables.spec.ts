import { afterEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EPublishKind, scanPublishables } from '../publishables'
import { makeFixture, type PublishFixture } from './fixture'

let fixture: PublishFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

const LAYOUT = {
  'home/.agents/skills/alpha/SKILL.md': 'alpha',
  'home/.agents/skills/alpha/refs/notes.md': 'notes',
  'home/.claude/skills/alpha/SKILL.md': 'claude alpha',
  'atlas-home/skills/beta/SKILL.md': 'beta',
  'atlas-home/ATLAS.md': 'be nice',
  'atlas-home/mcp.json': '{}',
  'atlas-home/memory/MEMORY.md': 'never',
}

describe('scanPublishables', () => {
  it('groups skill files one row per flavour and skill directory', async () => {
    fixture = await makeFixture(LAYOUT)
    const items = await scanPublishables(fixture)

    const skills = items.filter((item) => item.kind === EPublishKind.Skill)
    expect(skills.map((item) => item.id)).toEqual([
      'skill:.agents/alpha',
      'skill:.atlas/beta',
      'skill:.claude/alpha',
    ])
    const alpha = skills[0]
    expect(alpha?.files.map((file) => file.archiveKey)).toEqual([
      'user-layer/skills/.agents/alpha/SKILL.md',
      'user-layer/skills/.agents/alpha/refs/notes.md',
    ])
    expect(alpha?.bytes).toBe('alpha'.length + 'notes'.length)
  })

  it('offers only ATLAS.md and mcp.json beside skills, never memory', async () => {
    fixture = await makeFixture(LAYOUT)
    const items = await scanPublishables(fixture)

    const instructions = items.find((item) => item.kind === EPublishKind.Instructions)
    expect(instructions?.id).toBe('instructions:ATLAS.md')
    expect(instructions?.files[0]?.archiveKey).toBe('user-layer/instructions/.atlas/ATLAS.md')
    const mcp = items.find((item) => item.kind === EPublishKind.Mcp)
    expect(mcp?.id).toBe('mcp')
    expect(mcp?.files[0]?.archiveKey).toBe('.atlas/mcp.json')
    expect(items.flatMap((item) => item.files.map((file) => file.archiveKey)).some((key) => key.includes('memory'))).toBe(false)
  })

  it('omits instructions and mcp when the files are absent', async () => {
    fixture = await makeFixture({ 'home/.agents/skills/only/SKILL.md': 'x' })
    const items = await scanPublishables(fixture)
    expect(items.map((item) => item.kind)).toEqual([EPublishKind.Skill])
  })

  it('hashes stably and changes the hash when a file changes', async () => {
    fixture = await makeFixture(LAYOUT)
    const first = await scanPublishables(fixture)
    const second = await scanPublishables(fixture)
    expect(second.map((item) => item.hash)).toEqual(first.map((item) => item.hash))

    await writeFile(join(fixture.atlasHome, 'ATLAS.md'), 'be kind')
    const third = await scanPublishables(fixture)
    const changed = third.filter((item, index) => item.hash !== first[index]?.hash)
    expect(changed.map((item) => item.id)).toEqual(['instructions:ATLAS.md'])
  })
})
