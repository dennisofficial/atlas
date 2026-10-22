import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingKind,
  ESettingPage,
  ESettingsLayer,
  type ModelDefinition,
  type SettingDefinition,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileSettingsStore } from '../file-store'
import { MemorySettingsStore } from '../memory-store'
import { createSettingsService } from '../service'

const REPO_AGENT = 'agents.type.reviewer'
const GLOBAL_AGENT = 'agents.type.explore'

const modelRow = (args: { id: string; writeLayer?: ESettingsLayer.Project }): ModelDefinition => ({
  id: args.id,
  page: ESettingPage.Models,
  group: 'Sub-agent types',
  label: args.id,
  description: args.id,
  kind: ESettingKind.Model,
  fallback: '',
  ...(args.writeLayer === undefined ? {} : { writeLayer: args.writeLayer }),
})

const DEFINITIONS: readonly SettingDefinition[] = [
  ...ATLAS_SETTINGS,
  modelRow({ id: REPO_AGENT, writeLayer: ESettingsLayer.Project }),
  modelRow({ id: GLOBAL_AGENT }),
]

const stores = () => ({
  user: new MemorySettingsStore({ label: 'user' }),
  project: new MemorySettingsStore({ label: 'project' }),
})

const serviceOver = (args: {
  user: MemorySettingsStore | FileSettingsStore
  project?: MemorySettingsStore | FileSettingsStore
}) =>
  createSettingsService({
    definitions: DEFINITIONS,
    user: args.user,
    ...(args.project === undefined ? {} : { project: args.project }),
  })

const resolved = (service: ReturnType<typeof serviceOver>, id: string) =>
  service.snapshot().resolution.settings.get(id)

describe('project-scoped definitions', () => {
  it('writes a repository agent model to the project store and leaves user untouched', () => {
    const { user, project } = stores()
    const service = serviceOver({ user, project })

    expect(service.set({ id: REPO_AGENT, value: 'openai/gpt-5' })).toEqual({ ok: true })

    expect(project.document().values[REPO_AGENT]).toBe('openai/gpt-5')
    expect(user.document().values).toEqual({})
    expect(resolved(service, REPO_AGENT)?.layer).toBe(ESettingsLayer.Project)
  })

  it('keeps definitions without a write layer on the user store', () => {
    const { user, project } = stores()
    const service = serviceOver({ user, project })

    service.set({ id: GLOBAL_AGENT, value: 'openai/gpt-5' })
    service.set({ id: ESettingId.Accent, value: 'moss' })

    expect(user.document().values[GLOBAL_AGENT]).toBe('openai/gpt-5')
    expect(user.document().values[ESettingId.Accent]).toBe('moss')
    expect(project.document().values).toEqual({})
  })

  it('clearing reveals the global value without deleting it', () => {
    const user = new MemorySettingsStore({
      label: 'user',
      document: { values: { [REPO_AGENT]: 'anthropic/global' } },
    })
    const project = new MemorySettingsStore({ label: 'project' })
    const service = serviceOver({ user, project })

    service.set({ id: REPO_AGENT, value: 'openai/repo' })
    expect(resolved(service, REPO_AGENT)?.value).toBe('openai/repo')

    expect(service.clear({ id: REPO_AGENT })).toEqual({ ok: true })

    expect(project.document().values).toEqual({})
    expect(user.document().values[REPO_AGENT]).toBe('anthropic/global')
    expect(resolved(service, REPO_AGENT)?.value).toBe('anthropic/global')
    expect(resolved(service, REPO_AGENT)?.layer).toBe(ESettingsLayer.User)
  })

  it('refuses a project-scoped write when no project store exists, and never falls back to user', () => {
    const { user } = stores()
    const service = serviceOver({ user })
    const versionBefore = service.version()

    const set = service.set({ id: REPO_AGENT, value: 'openai/gpt-5' })
    const clear = service.clear({ id: REPO_AGENT })

    expect(set.ok).toBe(false)
    expect(clear.ok).toBe(false)
    if (!set.ok) expect(set.message).toContain(REPO_AGENT)
    expect(user.document().values).toEqual({})
    expect(service.version()).toBe(versionBefore)
  })

  it('reports the store each setting writes to, undefined when the project store is missing', () => {
    const withProject = serviceOver(stores())
    const userOnly = serviceOver({ user: stores().user })

    expect(withProject.writeOrigin(REPO_AGENT)).toBe('project')
    expect(withProject.writeOrigin(GLOBAL_AGENT)).toBe('user')
    expect(withProject.writeOrigin(ESettingId.Accent)).toBe('user')
    expect(withProject.writeOrigin('not.registered')).toBe('user')
    expect(userOnly.writeOrigin(REPO_AGENT)).toBeUndefined()
    expect(userOnly.writeOrigin(GLOBAL_AGENT)).toBe('user')
  })

  it('keeps snapshot.writesTo on the user destination', () => {
    expect(serviceOver(stores()).snapshot().writesTo).toBe('user')
  })

  it('a refused project write keeps the cached project value and reports the refusal', () => {
    const user = new MemorySettingsStore({ label: 'user' })
    const project = new MemorySettingsStore({
      label: 'project',
      document: { values: { [REPO_AGENT]: 'openai/repo' } },
      refuse: 'read-only file system',
    })
    const service = serviceOver({ user, project })

    expect(service.set({ id: REPO_AGENT, value: 'openai/other' })).toEqual({
      ok: false,
      message: 'read-only file system',
    })
    expect(resolved(service, REPO_AGENT)?.value).toBe('openai/repo')
  })

  it('notifies subscribers once per project write', () => {
    const service = serviceOver(stores())
    let told = 0
    service.subscribe(() => {
      told += 1
    })

    service.set({ id: REPO_AGENT, value: 'openai/gpt-5' })

    expect(told).toBe(1)
    expect(service.version()).toBe(1)
  })
})

describe('applyUserDocument with project-scoped definitions', () => {
  it('always lands on the user store', () => {
    const { user, project } = stores()
    const service = serviceOver({ user, project })

    const result = service.applyUserDocument({ values: { [REPO_AGENT]: 'openai/synced' } })

    expect(result).toEqual({ ok: true })
    expect(user.document().values[REPO_AGENT]).toBe('openai/synced')
    expect(project.document().values).toEqual({})
  })

  it('works without a project store', () => {
    const { user } = stores()

    expect(serviceOver({ user }).applyUserDocument({ values: { [REPO_AGENT]: 'x' } })).toEqual({
      ok: true,
    })
    expect(user.document().values[REPO_AGENT]).toBe('x')
  })
})

describe('project-scoped writes against real files', () => {
  const sandbox = () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-scoped-'))
    const userFile = join(root, 'home', 'settings.json')
    const projectFile = join(root, 'repo', '.atlas', 'settings.json')
    return {
      userFile,
      projectFile,
      user: new FileSettingsStore({ file: userFile, label: 'user' }),
      project: new FileSettingsStore({ file: projectFile, label: 'project' }),
    }
  }

  it('creates the project file and leaves the user file bytes unchanged', () => {
    const { user, project, userFile, projectFile } = sandbox()
    user.write({ values: { [ESettingId.Accent]: 'moss' } })
    const userBytes = readFileSync(userFile, 'utf8')
    const service = serviceOver({ user, project })

    expect(service.set({ id: REPO_AGENT, value: 'openai/gpt-5' })).toEqual({ ok: true })

    expect(readFileSync(projectFile, 'utf8')).toContain(`"${REPO_AGENT}": "openai/gpt-5"`)
    expect(readFileSync(userFile, 'utf8')).toBe(userBytes)
  })

  it('preserves unrelated keys edited externally since the last read', () => {
    const { user, project, projectFile } = sandbox()
    project.write({ values: { [ESettingId.SidebarWidth]: 50 } })
    const service = serviceOver({ user, project })

    project.write({ values: { [ESettingId.SidebarWidth]: 50, [ESettingId.Accent]: 'plum' } })
    service.set({ id: REPO_AGENT, value: 'openai/gpt-5' })

    const onDisk = JSON.parse(readFileSync(projectFile, 'utf8'))
    expect(onDisk[ESettingId.SidebarWidth]).toBe(50)
    expect(onDisk[ESettingId.Accent]).toBe('plum')
    expect(onDisk[REPO_AGENT]).toBe('openai/gpt-5')
  })

  it('retains a torn layer across a write to the other layer before repairing it', () => {
    for (const tornLayer of [ESettingsLayer.User, ESettingsLayer.Project]) {
      const { user, project, userFile, projectFile } = sandbox()
      user.write({ values: { [ESettingId.Accent]: 'moss' } })
      project.write({ values: { [ESettingId.SidebarWidth]: 50 } })
      const service = serviceOver({ user, project })
      const tornFile = tornLayer === ESettingsLayer.User ? userFile : projectFile
      writeFileSync(tornFile, '{ torn', 'utf8')
      const otherId = tornLayer === ESettingsLayer.User ? REPO_AGENT : GLOBAL_AGENT
      const repairId = tornLayer === ESettingsLayer.User ? GLOBAL_AGENT : REPO_AGENT

      expect(service.set({ id: otherId, value: 'openai/gpt-5' })).toEqual({ ok: true })
      expect(service.set({ id: repairId, value: 'openai/gpt-5' })).toEqual({ ok: true })

      const repaired = JSON.parse(readFileSync(tornFile, 'utf8'))
      const preservedId = tornLayer === ESettingsLayer.User ? ESettingId.Accent : ESettingId.SidebarWidth
      expect(repaired[preservedId]).toBe(tornLayer === ESettingsLayer.User ? 'moss' : 50)
      expect(repaired[repairId]).toBe('openai/gpt-5')
    }
  })

  it('a torn project file is merged onto its last-good values, not emptied', () => {
    const { user, project, projectFile } = sandbox()
    project.write({ values: { [ESettingId.SidebarWidth]: 50 } })
    const service = serviceOver({ user, project })

    writeFileSync(projectFile, '{ torn', 'utf8')
    expect(service.set({ id: REPO_AGENT, value: 'openai/gpt-5' })).toEqual({ ok: true })

    const onDisk = JSON.parse(readFileSync(projectFile, 'utf8'))
    expect(onDisk[ESettingId.SidebarWidth]).toBe(50)
    expect(onDisk[REPO_AGENT]).toBe('openai/gpt-5')
  })
})
