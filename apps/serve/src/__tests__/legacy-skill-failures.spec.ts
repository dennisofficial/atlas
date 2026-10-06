import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { join } from 'node:path'

import { nodeWorkspaceFiles, type WorkspaceFiles } from '../workspace-files'
import {
  archiveOf,
  LEGACY_STAMP,
  makeScratch,
  recover,
  stampOf,
  writeLegacyStamp,
  type Scratch,
} from './legacy-skill-fixture'

let scratch: Scratch

beforeEach(async () => {
  scratch = await makeScratch()
  await writeLegacyStamp({ scratch })
})

afterEach(async () => {
  await scratch.cleanup()
})

const skills = {
  '.agents/skills/handoff/SKILL.md': '# handoff',
  '.claude/skills/review/SKILL.md': '# review',
}

const stampStaysLegacy = async () => expect(await stampOf(scratch)).toEqual(LEGACY_STAMP)

const failingOn = (suffix: string): WorkspaceFiles => ({
  ...nodeWorkspaceFiles,
  writeBytes: async (args) => {
    if (args.path.endsWith(suffix)) throw new Error('disk full')
    await nodeWorkspaceFiles.writeBytes(args)
  },
})

describe('legacy-stamp skill recovery failures', () => {
  it('reports a partial write, keeps the old layout, and finishes on retry without reverting live edits', async () => {
    const archive = await archiveOf({ scratch, entries: skills })

    const failed = await recover({ scratch, archive, files: failingOn('review/SKILL.md') })

    expect(failed.failed).toContain('could not write .claude/skills/review/SKILL.md')
    expect(failed.failed).toContain('disk full')
    await stampStaysLegacy()

    await scratch.put({ path: join(scratch.atlasHome, '.agents/skills/handoff/SKILL.md'), content: '# live edit' })
    const retried = await recover({ scratch, archive })

    expect(retried.failed).toBeNull()
    expect(await scratch.readText(join(scratch.atlasHome, '.agents/skills/handoff/SKILL.md'))).toBe('# live edit')
    expect(await scratch.readText(join(scratch.atlasHome, '.claude/skills/review/SKILL.md'))).toBe('# review')
    expect((await stampOf(scratch)).skillLayout).toBe('persistent-v1')
  })

  it('does not upgrade when the archive will not extract', async () => {
    const readiness = await recover({ scratch, archive: new Uint8Array([1, 2, 3]) })

    expect(readiness.failed).toContain('did not extract')
    await stampStaysLegacy()
  })

  it('does not upgrade when the archive fetch throws', async () => {
    const readiness = await recover({
      scratch,
      archive: async () => {
        throw new Error('the control plane answered 502')
      },
    })

    expect(readiness.failed).toContain('502')
    await stampStaysLegacy()
  })

  it('does not upgrade when neither an archive nor a bundle can be found', async () => {
    const readiness = await recover({ scratch, archive: null })

    expect(readiness.failed).toContain('no context archive or bundle')
    await stampStaysLegacy()
  })

  it('does not upgrade on a corrupt legacy bundle', async () => {
    const readiness = await recover({ scratch, contextBundle: 'not json' })

    expect(readiness.failed).toContain('did not parse')
    await stampStaysLegacy()
  })

  it('does not upgrade when a legacy skill root cannot be read', async () => {
    await scratch.put({ path: join(scratch.legacyHome, '.agents/skills'), content: 'a file where a directory belongs' })
    const archive = await archiveOf({ scratch, entries: skills })

    const readiness = await recover({ scratch, archive })

    expect(readiness.failed).toContain('could not read')
    expect(await Bun.file(join(scratch.atlasHome, '.claude/skills/review/SKILL.md')).exists()).toBe(false)
    await stampStaysLegacy()
  })

  it('recovers from the legacy JSON bundle when no archive exists', async () => {
    const contextBundle = JSON.stringify({
      '.agents/skills/handoff/SKILL.md': Buffer.from('# handoff').toString('base64'),
      '.atlas/memory/MEMORY.md': Buffer.from('# stale').toString('base64'),
    })

    const readiness = await recover({ scratch, archive: null, contextBundle })

    expect(readiness).toEqual({ written: 1, failed: null, ...LEGACY_STAMP })
    expect(await scratch.readText(join(scratch.atlasHome, '.agents/skills/handoff/SKILL.md'))).toBe('# handoff')
    expect(await Bun.file(join(scratch.atlasHome, 'memory/MEMORY.md')).exists()).toBe(false)
    expect((await stampOf(scratch)).skillLayout).toBe('persistent-v1')
  })

  it('upgrades when a readable archive holds no compatibility skills', async () => {
    const archive = await archiveOf({ scratch, entries: { '.atlas/ATLAS.md': '# instructions' } })

    const readiness = await recover({ scratch, archive })

    expect(readiness).toEqual({ written: 0, failed: null, ...LEGACY_STAMP })
    expect((await stampOf(scratch)).skillLayout).toBe('persistent-v1')
  })
})
