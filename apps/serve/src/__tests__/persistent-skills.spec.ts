import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { ATLAS_SETTINGS, NoticePort, toThreadId, type NoticePost } from '@dltech/atlas-core'
import { composeHarness, inProcessPortBindings, MemorySettingsStore, createSettingsService } from '@dltech/atlas-harness'

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
  ports: inProcessPortBindings,
  clientVersion: 'persistent-skills-spec',
  userSkillHome: driveHome,
  surface: { notice: new SilentNotices() },
})

describe('skills in a cloud drive home', () => {
  it('loads a drive-home skill through the composed tool', async () => {
    const handoff = join(driveHome, '.agents/skills/handoff/SKILL.md')
    await put({ path: handoff, content: text({ name: 'handoff', body: 'Edited in cloud.' }) })
    const app = await compose()
    try {
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
    } finally {
      await app.close()
    }
  })
})
