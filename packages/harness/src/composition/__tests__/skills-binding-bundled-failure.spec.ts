import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ENoticeTone, NOTICE_WARN_MS } from '@dltech/atlas-core'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { liveSkillRegistry } from '../skills-binding'
import { recordingNotices } from './fakes'

let atlasHome: string
let project: string

beforeEach(() => {
  atlasHome = mkdtempSync(join(tmpdir(), 'skills-binding-home-'))
  project = mkdtempSync(join(tmpdir(), 'skills-binding-project-'))
})

afterEach(() => {
  rmSync(atlasHome, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

describe('liveSkillRegistry with an unusable bundled-skill cache', () => {
  it('keeps text-only built-ins and posts one warning notice for the bundled skill', async () => {
    writeFileSync(join(atlasHome, 'bin'), 'a file where the cache directory must go')
    const notices = recordingNotices()

    const registry = await liveSkillRegistry({
      atlasHome,
      home: project,
      cwd: project,
      notice: notices.port,
    })

    const names = registry.all().map((skill) => skill.spec.name)
    expect(names).toEqual(expect.arrayContaining(['commit', 'resolving-merge-conflicts']))
    expect(names).not.toContain('ui-design')
    expect(notices.posts).toHaveLength(1)
    expect(notices.posts[0]).toMatchObject({
      key: 'bundled-skill:ui-design',
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
    })
    expect(notices.posts[0]?.text).toContain('ui-design')
  })

  it('loads the bundled skill and posts nothing when the cache is usable', async () => {
    const notices = recordingNotices()

    const registry = await liveSkillRegistry({ atlasHome, home: project, cwd: project, notice: notices.port })

    expect(registry.byName('ui-design')?.directory).toContain(join(atlasHome, 'bin', 'skills'))
    expect(notices.posts).toEqual([])
  })
})
