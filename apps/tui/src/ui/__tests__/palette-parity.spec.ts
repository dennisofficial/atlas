import { describe, expect, it } from 'bun:test'

import { ACCENT, SHIPPED_PALETTE } from '../palette'
import { accentHex, accentPalette } from '../accents'

describe('the shipped graphite palette', () => {
  it('matches the graphite surfaces and text used on the web', () => {
    expect(SHIPPED_PALETTE).toMatchObject({
      appBg: '#252525',
      bright: '#eaeaea',
      userFg: '#eaeaea',
      body: '#b9b9b9',
      hover: '#eaeaea',
      dim: '#646464',
      hint: '#646464',
      meta: '#828282',
      rule: '#363636',
      hoverBg: '#282828',
      userBand: '#282828',
      selectedBg: '#343434',
      userBg: '#2f2f2f',
      caretFg: '#202020',
      overlayBg: '#202020',
      panelBand: '#202020',
      panelBg: '#1b1b1b',
      harnessBg: '#282828',
      harnessFg: '#eaeaea',
      court: { none: '#646464' },
      diff: { bandBg: '#202020', gutterFg: '#828282' },
    })
  })

  it('ships graphite on every accent role and preserves the other choices', () => {
    expect(ACCENT).toBe('#eaeaea')
    expect(accentHex('graphite')).toBe(ACCENT)
    expect(accentHex('sky')).toBe('#40c3f7')
    expect(accentHex('clay')).toBe('#d97757')
    expect(SHIPPED_PALETTE).toMatchObject(accentPalette('graphite'))
    expect(SHIPPED_PALETTE).toMatchObject({
      accent: ACCENT,
      caretBg: ACCENT,
      codeInline: ACCENT,
      court: { agent: ACCENT, yours: ACCENT },
    })
  })

  it('keeps semantic status and diff tints unchanged', () => {
    expect(SHIPPED_PALETTE).toMatchObject({
      error: '#e5534b',
      warn: '#e3b341',
      ok: '#57ab5a',
      okBright: '#7ee787',
      diff: { addBg: '#252d20', removeBg: '#322020', wordBg: '#335030' },
    })
  })
})
