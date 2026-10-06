import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { ATLAS_SETTINGS, toThreadId } from '@dltech/atlas-core'

import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { composeHarness } from '../compose'
import type { HarnessApp } from '../harness-app'
import { liveSkillRegistry } from '../skills-binding'
import { recordingNotices } from './fakes'

let root: string
let atlasHome: string
let project: string
let previousAtlasHome: string | undefined
const opened: HarnessApp<undefined, never>[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-compose-skill-home-'))
  atlasHome = join(root, 'drive-home')
  project = join(root, 'project')
  await mkdir(project, { recursive: true })
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
})

afterEach(async () => {
  for (const app of opened.splice(0)) await app.close()
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(root, { recursive: true, force: true })
})

const writeSkill = async (args: { directory: string; name: string; body: string }) => {
  const path = join(args.directory, args.name, 'SKILL.md')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `---\nname: ${args.name}\ndescription: skill home test\n---\n${args.body}`)
  return path
}

const compose = async (userSkillHome?: string) => {
  const app = await composeHarness<undefined, never>({
    launch: { cwd: project, command: 'serve', model: undefined, executionLocation: undefined },
    env: {},
    settings: {
      service: createSettingsService({
        definitions: ATLAS_SETTINGS,
        user: new MemorySettingsStore({ label: 'skill home spec' }),
      }),
      bindTo: () => {},
    },
    clientVersion: 'skill-home-spec',
    surface: { notice: recordingNotices().port },
    ...(userSkillHome === undefined ? {} : { userSkillHome }),
  })
  opened.push(app)
  return app
}

describe('composition with a user skill home', () => {
  it('loads compatibility skills and their assets from the selected persistent home', async () => {
    const path = await writeSkill({
      directory: join(atlasHome, '.agents', 'skills'),
      name: 'persisted-handoff',
      body: 'Write a continuation document.',
    })
    await writeFile(join(dirname(path), 'asset.bin'), Buffer.from([0, 255, 7]))
    await writeSkill({
      directory: join(atlasHome, '.claude', 'skills'),
      name: 'persisted-review',
      body: 'Review the continuation.',
    })

    const app = await compose(atlasHome)
    expect(app.skillRegistry.byName('persisted-handoff')?.entryPath).toBe(path)
    expect(app.skillRegistry.byName('persisted-review')?.body).toBe('Review the continuation.')
    const tool = app.tools.find('skill')
    if (tool === undefined) throw new Error('missing skill tool')
    const result = await tool.invoke({
      input: { name: 'persisted-handoff' },
      projectDirectory: project,
      threadId: toThreadId('skill-home-thread'),
      idempotencyKey: 'skill-home-key',
      signal: AbortSignal.timeout(10_000),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.modelText).toContain(dirname(path))
    expect(result.modelText).toContain('Write a continuation document.')
    expect(await readFile(join(dirname(path), 'asset.bin'))).toEqual(Buffer.from([0, 255, 7]))
  })

  it('keeps flavour precedence and project overrides while changing only user skill discovery', async () => {
    for (const [directory, body] of [
      [join(atlasHome, 'skills'), 'Atlas wins'],
      [join(atlasHome, '.agents', 'skills'), 'Agents loses'],
      [join(atlasHome, '.claude', 'skills'), 'Claude loses'],
    ]) {
      if (directory === undefined || body === undefined) throw new Error('missing fixture')
      await writeSkill({ directory, name: 'skill-home-collision', body })
    }
    const agentDirectory = join(atlasHome, '.agents', 'agents')
    await mkdir(agentDirectory, { recursive: true })
    await writeFile(join(agentDirectory, 'skill-home-agent.md'), '---\ndescription: Not a skill\n---\nAgent prompt.')

    const app = await compose(atlasHome)
    expect(app.skillRegistry.byName('skill-home-collision')?.body).toBe('Atlas wins')
    expect(app.agentTypes.types.some((type) => type.name === 'skill-home-agent')).toBe(false)
    const projectPath = await writeSkill({
      directory: join(project, '.atlas', 'skills'),
      name: 'skill-home-collision',
      body: 'Project wins',
    })
    await app.skillRegistry.reload()
    expect(app.skillRegistry.byName('skill-home-collision')?.entryPath).toBe(projectPath)
    expect(app.skillRegistry.byName('skill-home-collision')?.body).toBe('Project wins')
  })

  it('retains ordinary-home discovery when no override is supplied', async () => {
    await writeSkill({
      directory: join(atlasHome, '.agents', 'skills'),
      name: 'skill-home-only-on-drive',
      body: 'Cloud-only fixture.',
    })
    const expected = await liveSkillRegistry({ atlasHome, home: homedir(), cwd: project })
    const app = await compose()
    expect(app.skillRegistry.byName('skill-home-only-on-drive')).toBeUndefined()
    expect(app.skillRegistry.all().map((skill) => skill.entryPath)).toEqual(
      expected.all().map((skill) => skill.entryPath),
    )
  })

  it('preserves edits, additions and deletions when composing again against the same persistent home', async () => {
    const directory = join(atlasHome, '.agents', 'skills')
    await writeSkill({ directory, name: 'skill-home-edited', body: 'Old body.' })
    const deleted = await writeSkill({ directory, name: 'skill-home-deleted', body: 'Delete this.' })
    const first = await compose(atlasHome)
    expect(first.skillRegistry.byName('skill-home-deleted')).toBeDefined()
    await first.close()
    opened.splice(opened.indexOf(first), 1)
    await writeSkill({ directory, name: 'skill-home-edited', body: 'New body.' })
    await writeSkill({ directory, name: 'skill-home-added', body: 'Added in cloud.' })
    await rm(dirname(deleted), { recursive: true })

    const second = await compose(atlasHome)
    expect(second.skillRegistry.byName('skill-home-edited')?.body).toBe('New body.')
    expect(second.skillRegistry.byName('skill-home-added')?.body).toBe('Added in cloud.')
    expect(second.skillRegistry.byName('skill-home-deleted')).toBeUndefined()
  })
})
