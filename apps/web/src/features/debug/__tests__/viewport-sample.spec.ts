import { describe, expect, it } from 'bun:test'

import { probeRowsOf, type TViewportSample } from '../viewport-sample'

const sample: TViewportSample = {
  window: { width: 669, height: 869 },
  documentHeight: 869,
  visualViewport: { height: 869, offsetTop: 0 },
  screen: { width: 466, height: 678 },
  units: { svh: 869, lvh: 869, dvh: 869, vh: 869, fixedInset: 869 },
  insets: { top: 82, right: 0, bottom: 20, left: 0 },
  standalone: true,
}

describe('probeRowsOf', () => {
  it('lists every measurement with the top inset added to svh', () => {
    const rows = Object.fromEntries(probeRowsOf(sample).map((row) => [row.label, row.value]))
    expect(rows).toMatchObject({
      standalone: 'yes',
      window: '669 × 869',
      visualViewport: '869 (top 0)',
      screen: '466 × 678',
      'insets t r b l': '82 0 20 0',
      'svh + top inset': '951',
    })
  })

  it('says when the browser has no visual viewport', () => {
    const rows = probeRowsOf({ ...sample, visualViewport: null })
    expect(rows.find((row) => row.label === 'visualViewport')?.value).toBe('none')
  })
})
