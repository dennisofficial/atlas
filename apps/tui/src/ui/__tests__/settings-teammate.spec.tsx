import {
  ATLAS_SETTINGS,
  agentTypeModelDefinitions,
  EDefinitionOrigin,
  agentTypeSettingId,
  ESettingsLayer,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { glyph } from '../theme'
import { NARROW, WIDE, page, rowsOf, rowWith } from './settings-render-fixture'

const builtIn = (names: readonly string[]) =>
  names.map((name) => ({ name, origin: EDefinitionOrigin.BuiltIn }))

const definitions = [
  ...ATLAS_SETTINGS,
  ...agentTypeModelDefinitions({ types: builtIn(['builder', 'explore', 'teammate']) }),
]
const state = { pageIndex: 1, rowIndex: 2 }

describe('teammate model settings', () => {
  it('renders teammates in the first section, following the main agent', async () => {
    for (const width of [NARROW, WIDE, 200]) {
      const rows = await rowsOf(page({ definitions, state, width }), width)
      const teammates = rows.findIndex((row) => row.includes('Teammates'))
      const background = rows.findIndex((row) => row.includes('BACKGROUND PROCESSES'))
      const subagents = rows.findIndex((row) => row.includes('BUILT-IN SUB-AGENTS'))

      expect(teammates).toBeGreaterThan(rows.findIndex((row) => row.includes('Default effort')))
      expect(teammates).toBeLessThan(background)
      expect(background).toBeLessThan(subagents)
      expect(rowWith(rows, 'Teammates')).toContain('follow main agent')
      expect(rowWith(rows, 'explore agents')).toContain('follow sub-agents')
      expect(rows[teammates]).toContain(glyph.selected)
    }
  })

  it('still displays an explicit teammate override', async () => {
    const rows = await rowsOf(page({
      definitions,
      state,
      layers: [{
        layer: ESettingsLayer.User,
        origin: '~/.atlas/settings.json',
        values: { [agentTypeSettingId('teammate')]: 'openai/gpt-5' },
      }],
    }), WIDE)

    expect(rowWith(rows, 'Teammates')).toContain('openai/gpt-5')
    expect(rowWith(rows, 'Teammates')).not.toContain('follow main agent')
  })
})
