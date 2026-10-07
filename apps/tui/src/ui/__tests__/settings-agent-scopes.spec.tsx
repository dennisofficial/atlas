import {
  ATLAS_SETTINGS,
  agentTypeModelDefinitions,
  agentTypeSettingId,
  EDefinitionOrigin,
  ESettingPage,
  resolveSettings,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { glyph } from '../theme'
import {
  currentRow,
  isOverriddenSetting,
  moveRow,
  settingRowKey,
  settingsModel,
  type ShadowedAgentTypeSource,
} from '../settings-model'
import { NARROW, WIDE, page, rowsOf, rowWith } from './settings-render-fixture'

const PROJECT_FILE = '/work/repo/.atlas/settings.json'
const USER_FILE = '/home/me/.atlas/settings.json'
const REPO_AGENT = '/work/repo/.atlas/agents/reviewer.md'
const GLOBAL_AGENT = '/home/me/.atlas/agents/reviewer.md'
const COMPAT_AGENT = '/work/repo/.claude/agents/reviewer.md'

const types = [
  { name: 'teammate', origin: EDefinitionOrigin.BuiltIn },
  { name: 'explore', origin: EDefinitionOrigin.BuiltIn },
  { name: 'reviewer', origin: EDefinitionOrigin.Project, definedIn: REPO_AGENT },
  { name: 'auditor', origin: EDefinitionOrigin.Project, definedIn: COMPAT_AGENT },
  { name: 'writer', origin: EDefinitionOrigin.User, definedIn: '/home/me/.atlas/agents/writer.md' },
]

const shadowed: readonly ShadowedAgentTypeSource[] = [
  { name: 'reviewer', origin: EDefinitionOrigin.User, definedIn: GLOBAL_AGENT, shadowedBy: EDefinitionOrigin.Project },
  { name: 'reviewer', origin: EDefinitionOrigin.User, definedIn: COMPAT_AGENT, shadowedBy: EDefinitionOrigin.Project },
  { name: 'explore', origin: EDefinitionOrigin.BuiltIn, definedIn: undefined, shadowedBy: EDefinitionOrigin.User },
]

const definitions = [...ATLAS_SETTINGS, ...agentTypeModelDefinitions({ types })]

const writeOriginOf = (id: string): string | undefined =>
  definitions.find((definition) => definition.id === id)?.writeLayer === 'project'
    ? PROJECT_FILE
    : USER_FILE

const modelPage = (withShadows = true) => {
  const resolution = resolveSettings({ definitions, layers: [] })
  const model = settingsModel({
    definitions,
    resolution,
    ...(withShadows ? { shadowedAgentTypes: shadowed } : {}),
    writeOriginOf,
  })
  const held = model.pages.find((entry) => entry.page.id === ESettingPage.Models)
  if (held === undefined) throw new Error('no models page')
  return { model, held }
}

const nameOf = (setting: { definition: { label: string } }): string => setting.definition.label

describe('the models page agent sections', () => {
  it('orders built-in, repository and global sections, rows alphabetical, teammates kept in Model', () => {
    const { held } = modelPage()

    expect(held.groups.map((group) => group.label)).toEqual([
      'Model',
      'Background processes',
      'Built-in sub-agents',
      'Repository-defined sub-agents',
      'Global user-defined sub-agents',
    ])
    expect(held.groups[0]?.rows.map(nameOf)).toContain('Teammates')
    expect(held.groups[2]?.rows.map(nameOf)).toEqual(['explore agents', 'explore agents'])
    expect(held.groups[3]?.rows.map(nameOf)).toEqual(['auditor agents', 'reviewer agents'])
    expect(held.groups[4]?.rows.map(nameOf)).toEqual([
      'reviewer agents',
      'reviewer agents',
      'writer agents',
    ])
  })

  it('hides sections with nothing in them', () => {
    const resolution = resolveSettings({ definitions, layers: [] })
    const model = settingsModel({ definitions: ATLAS_SETTINGS, resolution })

    expect(
      model.pages
        .flatMap((entry) => entry.groups.map((group) => group.label))
        .filter((label) => label.includes('sub-agents')),
    ).toEqual([])
  })

  it('gives same-name rows distinct keys even when two shadows differ only by file', () => {
    const { held } = modelPage()
    const reviewers = held.rows.filter((row) => nameOf(row) === 'reviewer agents')
    const keys = reviewers.map(settingRowKey)

    expect(reviewers).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
    expect(keys.filter((key) => key === agentTypeSettingId('reviewer'))).toHaveLength(1)
    expect(new Set(held.rows.map(settingRowKey)).size).toBe(held.rows.length)
  })

  it('marks only shadow rows as overridden and keeps them out of the stored resolution', () => {
    const { held } = modelPage()
    const resolution = resolveSettings({ definitions, layers: [] })

    expect(held.rows.filter(isOverriddenSetting)).toHaveLength(3)
    expect(held.rows.filter((row) => !isOverriddenSetting(row)).every((row) => resolution.settings.get(row.definition.id) !== undefined)).toBe(true)
    expect([...resolution.settings.keys()].filter((id) => id === agentTypeSettingId('reviewer'))).toHaveLength(1)
  })

  it('carries each row its own save destination', () => {
    const { held } = modelPage(false)
    const byLabel = (label: string) => held.rows.find((row) => nameOf(row) === label)

    expect(byLabel('reviewer agents')?.writeOrigin).toBe(PROJECT_FILE)
    expect(byLabel('writer agents')?.writeOrigin).toBe(USER_FILE)
    expect(byLabel('Teammates')?.writeOrigin).toBe(USER_FILE)
  })

  it('lets the cursor walk every row including shadows', () => {
    const { model, held } = modelPage()
    let state = { pageIndex: model.pages.findIndex((entry) => entry === held), rowIndex: 0 }
    const seen = new Set<string>()
    for (let step = 0; step < held.rows.length; step += 1) {
      const row = currentRow({ state, model })
      if (row !== undefined) seen.add(settingRowKey(row))
      state = moveRow({ state, model, delta: 1 })
    }

    expect(seen.size).toBe(held.rows.length)
  })
})

describe('the models page agent rows on screen', () => {
  const modelsState = (rowIndex: number) => ({ pageIndex: 1, rowIndex })
  const shadowIndex = modelPage().held.rows.findIndex(
    (row) => isOverriddenSetting(row) && nameOf(row) === 'explore agents',
  )
  const activeProjectIndex = modelPage().held.rows.findIndex(
    (row) => !isOverriddenSetting(row) && nameOf(row) === 'reviewer agents',
  )
  const shown = (state: { pageIndex: number; rowIndex: number }, width = WIDE) =>
    rowsOf(page({ definitions, shadowedAgentTypes: shadowed, writeOriginOf, state, width }), width)

  it('headings the three sections', async () => {
    const rows = await shown(modelsState(0))

    for (const heading of ['BUILT-IN SUB-AGENTS', 'REPOSITORY-DEFINED SUB-AGENTS', 'GLOBAL USER-DEFINED SUB-AGENTS']) {
      expect(rowWith(rows, heading)).not.toBe('')
    }
  })

  it('shows a shadow as overridden with no chooser affordance', async () => {
    const rows = await shown(modelsState(shadowIndex))
    const struck = rows.filter((row) => row.includes('overridden'))

    expect(struck.length).toBeGreaterThan(0)
    expect(struck.some((row) => row.includes('choose'))).toBe(false)
    expect(rowWith(rows, 'follow sub-agents')).toContain('choose')
  })

  it('warns in the sidebar with source and the winning origin', async () => {
    const rows = await shown(modelsState(shadowIndex))
    const frame = rows.join('\n')

    expect(frame).toContain('DEFINED IN')
    expect(frame).toContain('Built-in')
    expect(frame).toContain('Overridden by the global user')
    expect(frame).not.toContain('SET BY')
    expect(frame).not.toContain('SAVES TO')
  })

  it('names the definition file of a repository-shadowing global row', async () => {
    const index = modelPage().held.rows.findIndex(
      (row) => isOverriddenSetting(row) && settingRowKey(row).includes(GLOBAL_AGENT),
    )
    const frame = (await shown(modelsState(index))).join('\n')

    expect(frame).toContain('agents/reviewer.md')
    expect(frame).toContain('Overridden by the repository')
  })

  it('names the repository file an active repository agent saves to', async () => {
    const frame = (await shown(modelsState(activeProjectIndex))).join('\n')

    expect(frame).toContain('SAVES TO')
    expect(frame).toContain('Saves to project settings')
    expect(frame).toContain('.atlas/settings.json')
    expect(frame).toContain(glyph.selected)
  })

  it('keeps overridden status and the honest destination in the footer when the sidebar is folded', async () => {
    const onShadow = (await shown(modelsState(shadowIndex), NARROW)).join('\n')
    const onProject = (await shown(modelsState(activeProjectIndex), NARROW)).join('\n')

    expect(onShadow).toContain('overridden · read only')
    expect(onShadow).not.toContain('edits write to')
    expect(onProject).toContain(`edits write to ${PROJECT_FILE}`)
  })

  it('says project settings are unavailable instead of claiming a global save', async () => {
    const rows = await rowsOf(
      page({
        definitions,
        shadowedAgentTypes: shadowed,
        writeOriginOf: (id) => (writeOriginOf(id) === PROJECT_FILE ? undefined : USER_FILE),
        state: modelsState(activeProjectIndex),
        width: NARROW,
      }),
      NARROW,
    )
    const frame = rows.join('\n')

    expect(frame).toContain('project settings unavailable')
    expect(frame).not.toContain(`edits write to ${USER_FILE}`)
  })

  it('leaves default rows and the teammate row as they were', async () => {
    const rows = await shown(modelsState(2))

    expect(rowWith(rows, 'Teammates')).toContain('follow main agent')
    expect(rows.join('\n')).toContain(`edits write to ${USER_FILE}`)
  })
})
