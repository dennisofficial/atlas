import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { ATLAS_SETTINGS, NoticePort, toThreadId, type NoticePost } from '@dltech/atlas-core'
import { buildContextArchive, composeHarness, MemorySettingsStore, createSettingsService } from '@dltech/atlas-harness'

import { materializeContext } from '../materialize-context'
import type { WorkspaceSpec } from '../workspace-spec'

const SPEC: WorkspaceSpec = {
  remoteUrl: null, branch: null, commit: null, patch: '', githubToken: null, contextBundle: null,
}

class SilentNotices extends NoticePort {
  notify(_post: NoticePost): void {}
}

let root: string
let driveHome: string
let cwd: string
let previousAtlasHome: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-persistent-skills-'))
  driveHome = join(root, 'drive-home')
  cwd = join(root, 'workspace')
  await mkdir(cwd, { recursive: true })
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = driveHome
})

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(root, { recursive: true, force: true })
})

const put = async (args: { path: string; content: string | Buffer }) => {
  await mkdir(dirname(args.path), { recursive: true })
  await writeFile(args.path, args.content)
}

const text = (args: { name: string; body: string }) =>
  `---\nname: ${args.name}\ndescription: persistent skill test\n---\n${args.body}`

const compose = () => composeHarness<undefined, never>({
  launch: { cwd, command: 'serve', model: undefined, executionLocation: undefined },
  env: {},
  settings: {
    service: createSettingsService({ definitions: ATLAS_SETTINGS, user: new MemorySettingsStore({ label: 'persistent skill spec' }) }),
    bindTo: () => {},
  },
  clientVersion: 'persistent-skills-spec',
  userSkillHome: driveHome,
  surface: { notice: new SilentNotices() },
})

describe('skills across cloud context recreation', () => {
  it('loads handoff through the recomposed tool after the old ordinary home is gone', async () => {
    const entries: readonly { key: string; content: string | Buffer }[] = [
      { key: '.agents/skills/handoff/SKILL.md', content: text({ name: 'handoff', body: 'Initial handoff.' }) },
      { key: '.agents/skills/handoff/asset.bin', content: Buffer.from([0, 255, 7]) },
      { key: '.claude/skills/deleted/SKILL.md', content: text({ name: 'deleted', body: 'Remove this skill.' }) },
      { key: '.atlas/memory/MEMORY.md', content: 'Old bootstrap memory.' },
    ]
    const sources = []
    for (const entry of entries) {
      const path = join(root, 'source', entry.key)
      await put({ path, content: entry.content })
      sources.push({ key: entry.key, path })
    }
    const archive = await buildContextArchive({ files: sources })
    if (archive === undefined) throw new Error('missing archive')
    const oldHome = join(root, 'old-ordinary-home')
    await mkdir(oldHome)
    const restored = await materializeContext({
      atlasHome: driveHome, cwd, home: oldHome,
      fetchSpec: async () => SPEC, fetchArchive: async () => archive,
    })
    expect(restored.failed).toBeNull()
    expect(restored.written).toBe(4)
    const handoff = join(driveHome, '.agents/skills/handoff/SKILL.md')
    await put({ path: handoff, content: text({ name: 'handoff', body: 'Edited in cloud.' }) })
    await put({ path: join(driveHome, '.agents/skills/added/SKILL.md'), content: text({ name: 'added', body: 'Added in cloud.' }) })
    await put({ path: join(driveHome, 'memory/MEMORY.md'), content: 'Live memory.' })
    await rm(join(driveHome, '.claude/skills/deleted'), { recursive: true })
    await rm(oldHome, { recursive: true })
    const newHome = join(root, 'new-ordinary-home')
    await mkdir(newHome)
    const resumed = await materializeContext({
      atlasHome: driveHome, cwd, home: newHome,
      fetchSpec: async () => { throw new Error('must not replay spec') },
      fetchArchive: async () => { throw new Error('must not replay archive') },
    })
    expect(resumed.failed).toBeNull()
    expect(resumed.written).toBe(0)

    const app = await compose()
    try {
      expect(app.skillRegistry.byName('added')?.body).toBe('Added in cloud.')
      expect(app.skillRegistry.byName('deleted')).toBeUndefined()
      const tool = app.tools.find('skill')
      if (tool === undefined) throw new Error('missing skill tool')
      const loaded = await tool.invoke({
        input: { name: 'handoff' }, projectDirectory: cwd, threadId: toThreadId('persistent-skills'),
        idempotencyKey: 'persistent-skill-load', signal: AbortSignal.timeout(10_000),
      })
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) throw new Error(loaded.reason)
      expect(loaded.modelText).toContain(dirname(handoff))
      expect(loaded.modelText).toContain('Edited in cloud.')
      expect(await readFile(join(dirname(handoff), 'asset.bin'))).toEqual(Buffer.from([0, 255, 7]))
      expect(await readFile(join(driveHome, 'memory/MEMORY.md'), 'utf8')).toBe('Live memory.')
    } finally {
      await app.close()
    }
  })
})
