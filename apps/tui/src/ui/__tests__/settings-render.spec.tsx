import { ATLAS_SETTINGS, ESettingId, ESettingsLayer } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { settingsDetailVisible } from '../components/settings'
import { cellsOf } from '../hint-layout'
import { OPTION_SEPARATOR, RANGE_HINT, TEXT_HINT, TOGGLE_HINT } from '../settings-format'
import { CHOSEN, COMPOSER_DRAFT, DIFF_PATH, UNCHOSEN } from '../components/settings/previews'
import { glyph, SIDEBAR_WIDTH } from '../theme'
import { CUSTOM_DECISIONS, WIDE, NARROW, ORIGIN, page, rowsOf, stateOf, ACCENT_ROW, SIDEBAR_ROW, DENSITY_ROW, COMPOSER_ROW, BAND_EDGE, BAND_TOP_LEFT, BAND_TOP_RIGHT, BAND_BOTTOM_LEFT, rowWith } from './settings-render-fixture'

describe('the settings page', () => {
  it('names itself and the page it is on', async () => {
    const head = (await rowsOf(page({}), WIDE))[0] ?? ''

    expect(head).toContain(`${glyph.block} settings`)
    expect(head).toContain('general')
    expect(head).toContain('appearance')
    expect(head).toContain(ORIGIN)
  })

  it('heads each group and lists its rows', async () => {
    const rows = await rowsOf(page({}), WIDE)

    expect(rowWith(rows, 'TRANSCRIPT')).not.toBe('')
    expect(rowWith(rows, 'LAYOUT')).not.toBe('')
    expect(rowWith(rows, 'Smooth streaming')).toContain('on')
    expect(rowWith(rows, 'Sidebar width')).toContain('42 cols')
  })

  it('says what each kind of row responds to', async () => {
    const rows = await rowsOf(page({}), WIDE)

    expect(rowWith(rows, 'Smooth streaming')).toContain(TOGGLE_HINT)
    expect(rowWith(rows, 'Sidebar width')).toContain(RANGE_HINT)
    expect(rowWith(rows, 'Accent')).toBe('')

    const textOnly = ATLAS_SETTINGS.filter((row) => row.id === ESettingId.DecisionsUrl || row.id === ESettingId.DecisionsProvider)
    const textRows = await rowsOf(page({ definitions: textOnly, layers: CUSTOM_DECISIONS }), WIDE)
    expect(rowWith(textRows, 'Decision endpoint')).toContain(TEXT_HINT)
  })

  it('lists the options a choice offers', async () => {
    const rows = await rowsOf(page({ state: { pageIndex: 2, rowIndex: 0 } }), WIDE)

    expect(rowWith(rows, 'Accent')).toContain(
      ['clay', 'slate', 'moss', 'plum'].join(OPTION_SEPARATOR),
    )
  })

  it('marks the selected row and only that row', async () => {
    const rows = await rowsOf(page({ state: stateOf(ESettingId.SidebarWidth) }), WIDE)
    const marked = rows.filter((row) => row.includes(glyph.selected))

    expect(marked).toHaveLength(1)
    expect(marked[0]).toContain('Sidebar width')
  })

  it('explains the selected row and where its value came from', async () => {
    const rows = await rowsOf(
      page({
        layers: [
          {
            layer: ESettingsLayer.Environment,
            origin: 'environment',
            values: { [ESettingId.SmoothStreaming]: 'off' },
            origins: { [ESettingId.SmoothStreaming]: 'ATLAS_SMOOTH_STREAMING' },
          },
        ],
      }),
      WIDE,
    )

    expect(rowWith(rows, 'SMOOTH STREAMING')).not.toBe('')
    expect(rowWith(rows, 'Reveal assistant text')).not.toBe('')
    expect(rowWith(rows, 'SET BY')).not.toBe('')
    expect(rowWith(rows, 'environment · ATLAS_SMOOTH_STREAMING')).not.toBe('')
  })

  it('says where edits land, and says instead what went wrong', async () => {
    expect(rowWith(await rowsOf(page({}), WIDE), 'edits write to')).toContain(ORIGIN)
    expect(rowWith(await rowsOf(page({ problem: 'read-only' }), WIDE), 'read-only')).not.toBe('')
  })

  it('offers the keys that move around it', async () => {
    const rows = await rowsOf(page({}), WIDE)
    const footer = rowWith(rows, 'edits write to')

    expect(footer).toContain('↑↓')
    expect(footer).toContain('⇥')
    expect(footer).toContain('esc')
  })

  it('drops the explanation pane rather than the rows when the terminal is narrow', async () => {
    const rows = await rowsOf(page({ width: NARROW }), NARROW)

    expect(settingsDetailVisible({ width: NARROW, sidebarWidth: SIDEBAR_WIDTH })).toBe(false)
    expect(rowWith(rows, 'Smooth streaming')).not.toBe('')
    expect(rowWith(rows, 'SET BY')).toBe('')
  })

  it('gives the explanation pane exactly the sidebar width it was handed', async () => {
    for (const sidebarWidth of [SIDEBAR_WIDTH, 56]) {
      const rows = await rowsOf(page({ sidebarWidth }), WIDE)

      expect(rowWith(rows, 'SET BY').indexOf('SET BY')).toBe(WIDE - sidebarWidth + 2)
    }
  })

  it('drops the pane once it would leave the rows no room, however wide the terminal', async () => {
    const rows = await rowsOf(page({ sidebarWidth: 70 }), WIDE)

    expect(settingsDetailVisible({ width: WIDE, sidebarWidth: 70 })).toBe(false)
    expect(rowWith(rows, 'Smooth streaming')).not.toBe('')
    expect(rowWith(rows, 'SET BY')).toBe('')
  })

  it('bands the row under the cursor with a preview of what it changes', async () => {
    const rows = await rowsOf(page({ state: ACCENT_ROW }), WIDE)

    expect(rowWith(rows, `${CHOSEN} clay`)).not.toBe('')
    expect(rowWith(rows, `${UNCHOSEN} slate`)).not.toBe('')
  })

  it('bands nothing under a row whose effect is already on screen', async () => {
    const rows = await rowsOf(page({ state: SIDEBAR_ROW }), WIDE)

    expect(rowWith(rows, 'Sidebar width')).not.toBe('')
    expect(rowWith(rows, `${UNCHOSEN} slate`)).toBe('')
  })

  it('keeps a preview as wide as the band and no wider', async () => {
    const rows = await rowsOf(page({ state: DENSITY_ROW }), WIDE)
    const top = rows.findIndex((row) => row.includes(BAND_TOP_LEFT))
    const bottom = rows.findIndex((row) => row.includes(BAND_BOTTOM_LEFT))
    const opening = (rows[top] ?? '').indexOf(BAND_TOP_LEFT)
    const closing = (rows[top] ?? '').indexOf(BAND_TOP_RIGHT)

    expect(rowWith(rows, DIFF_PATH)).not.toBe('')
    expect(top).toBeGreaterThan(0)
    expect(bottom).toBeGreaterThan(top + 2)

    for (const row of rows.slice(top + 1, bottom)) {
      expect(row.indexOf(BAND_EDGE)).toBe(opening)
      expect(row.lastIndexOf(BAND_EDGE)).toBe(closing)
    }
  })

  it('draws a composer under the setting that shapes the composer', async () => {
    const rows = await rowsOf(page({ state: COMPOSER_ROW }), WIDE)

    expect(rowWith(rows, COMPOSER_DRAFT)).not.toBe('')
  })

  it('keeps every row inside the terminal at any width', async () => {
    for (const width of [NARROW, 100, WIDE, 200]) {
      for (const row of await rowsOf(page({ width }), width)) {
        expect(cellsOf(row.trimEnd())).toBeLessThanOrEqual(width)
      }
    }
  })
})
