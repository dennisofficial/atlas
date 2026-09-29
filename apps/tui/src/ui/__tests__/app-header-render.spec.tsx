import { describe, expect, it } from 'bun:test'
import React from 'react'

import { HeaderBar } from '../components/header-bar'
import { Screen } from '../components/screen'
import { HEADER_GUTTER } from '../header-bar'
import { CWD, frameOf } from './transcript-fixture'

const WIDE = 120

const screen = (diff: { added: number; removed: number } | null): React.ReactNode => (
  <Screen
    header={<HeaderBar width={WIDE} projectDirectory={CWD} repoRoot={CWD} diff={diff} />}
  >
    <text>transcript body</text>
  </Screen>
)

describe('the app header', () => {
  it('paints on the terminal top row, above everything else', async () => {
    const rows = (await frameOf(screen(null), WIDE)).split('\n')

    expect(rows[0]).toContain('atlas')
    const body = rows.findIndex((row) => row.includes('transcript body'))
    expect(body).toBeGreaterThan(0)
  })

  it('holds the diff at the far right of the whole terminal, not the transcript column', async () => {
    const top = (await frameOf(screen({ added: 5, removed: 3 }), WIDE)).split('\n')[0] ?? ''

    expect(top.trimEnd().endsWith('+5  -3')).toBe(true)
    expect(top.trimEnd().length).toBe(WIDE - HEADER_GUTTER)
  })
})
