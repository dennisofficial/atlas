import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { EDefinitionOrigin, EEffort, ESettingsLayer, ESettingId } from '@dltech/atlas-core'

import { createHarnessContainer } from '../../container/create-harness-container'
import { HookChain } from '../../hooks/registry'
import type { SettingsService } from '../../settings/service'
import { bindSessionAgentTypes } from '../compose-agent-types'
import { childModelSelection } from '../child-model'
import { rememberSettingModel } from '../model-preference'
import { loadSettings } from '../settings-binding'
import { childModelFixture, cleanupHomes } from './child-model-fixtures'
import { fakeCatalogue } from './fakes'

let root: string
let home: string
let project: string
let previousHome: string | undefined
const opened: SettingsService[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-agent-scopes-'))
  home = join(root, 'user')
  project = join(root, 'repo')
  await mkdir(project, { recursive: true })
  previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
})

afterEach(async () => {
  for (const service of opened.splice(0)) service.close()
  if (previousHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousHome
  await cleanupHomes()
  await rm(root, { recursive: true, force: true })
})

const writeAgent = async (args: { directory: string; name: string; model?: string }) => {
  const file = join(args.directory, `${args.name}.md`)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, [
    '---',
    `name: ${args.name}`,
    'description: Review changes',
    ...(args.model === undefined ? [] : [`model: ${args.model}`]),
    '---',
    'Review the changes carefully.',
  ].join('\n'))
  return file
}

const bind = async () => {
  const settings = loadSettings({ env: {}, cwd: project }).service
  opened.push(settings)
  const catalog = await bindSessionAgentTypes({
    container: createHarnessContainer(),
    settings,
    launchValue: () => undefined,
    models: fakeCatalogue(),
    roots: { atlasHome: home, home: join(root, 'ordinary-home'), cwd: project },
  })
  return { settings, catalog }
}

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'))

const pick = (settings: SettingsService, id: string) => rememberSettingModel({
  settings,
  target: { id, withEffort: false },
  selection: { ref: { providerId: 'openai', modelId: 'gpt-5-codex' }, effort: EEffort.Medium },
})

describe('agent model scope across discovery, settings and child selection', () => {
  it('saves the repository winner locally, keeps shadow definitions out of settings and survives a restart', async () => {
    const userFile = join(home, 'settings.json')
    await mkdir(home, { recursive: true })
    const original = '{"agents.type.reviewer":"anthropic/claude-opus-5","appearance.accent":"moss"}\n'
    await writeFile(userFile, original)
    const repoAgent = await writeAgent({
      directory: join(project, '.atlas', 'agents'), name: 'reviewer', model: 'openai/gpt-5-codex',
    })
    await writeAgent({ directory: join(home, 'agents'), name: 'reviewer' })

    const first = await bind()
    const reviewer = first.catalog.types.find((type) => type.name === 'reviewer')
    expect(reviewer?.definedIn).toBe(repoAgent)
    expect(first.catalog.shadowed.filter((type) => type.name === 'reviewer').map((type) => type.origin).sort())
      .toEqual([EDefinitionOrigin.BuiltIn, EDefinitionOrigin.User].sort())
    expect(first.settings.definitions.filter((definition) => definition.id === 'agents.type.reviewer')).toHaveLength(1)
    expect(first.settings.definitions.find((definition) => definition.id === 'agents.type.reviewer')?.writeLayer)
      .toBe(ESettingsLayer.Project)
    expect(pick(first.settings, 'agents.type.reviewer')).toEqual({ ok: true })
    expect(await readFile(userFile, 'utf8')).toBe(original)
    expect(await readJson(join(project, '.atlas', 'settings.json')))
      .toEqual({ 'agents.type.reviewer': 'openai/gpt-5-codex' })

    const second = await bind()
    expect(second.settings.snapshot().resolution.settings.get('agents.type.reviewer')?.layer)
      .toBe(ESettingsLayer.Project)
    const fixture = await childModelFixture()
    const select = childModelSelection({
      settings: second.settings, models: fixture.models, model: fixture.parent,
      threads: fixture.threads, hooks: () => new HookChain({}),
    })
    if (reviewer === undefined) throw new Error('reviewer did not load')
    expect((await select({ agentType: reviewer, spawnedBy: fixture.threadId })).ref).toBe('openai/gpt-5-codex')
    expect(second.settings.clear({ id: 'agents.type.reviewer' })).toEqual({ ok: true })
    expect(await readFile(userFile, 'utf8')).toBe(original)
    expect((await select({ agentType: reviewer, spawnedBy: fixture.threadId })).ref).toBe('anthropic/claude-opus-5')
  })

  it('keeps built-in, global and default model preferences in the user file', async () => {
    await writeAgent({ directory: join(home, 'agents'), name: 'auditor' })
    const { settings } = await bind()
    expect(pick(settings, 'agents.type.auditor')).toEqual({ ok: true })
    expect(pick(settings, 'agents.type.builder')).toEqual({ ok: true })
    expect(pick(settings, ESettingId.ModelId)).toEqual({ ok: true })

    expect(await readJson(join(home, 'settings.json'))).toEqual({
      'agents.type.auditor': 'openai/gpt-5-codex',
      'agents.type.builder': 'openai/gpt-5-codex',
      'model.id': 'openai/gpt-5-codex',
    })
    expect(settings.writeOrigin('agents.type.auditor')).toBe(settings.snapshot().writesTo)
  })
})
