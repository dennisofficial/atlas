import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  EffortDial,
  EffortGauge,
  effortArc,
  effortFraction,
  effortNeedleDegrees,
  effortTickLeft,
} from '../effort-dial'
import { EEffort } from '../model-selector-groups'

const EFFORTS = [EEffort.Low, EEffort.Medium, EEffort.High, EEffort.XHigh, EEffort.Max]

describe('effortFraction', () => {
  it('spreads the offered rungs across the dial', () => {
    expect(effortFraction({ efforts: EFFORTS, value: EEffort.Low })).toBe(0)
    expect(effortFraction({ efforts: EFFORTS, value: EEffort.High })).toBe(0.5)
    expect(effortFraction({ efforts: EFFORTS, value: EEffort.Max })).toBe(1)
  })

  it('shows a rung the model does not offer as empty', () => {
    expect(effortFraction({ efforts: [EEffort.Low, EEffort.High], value: EEffort.Max })).toBe(0)
  })

  it('fills the dial for a model with one rung', () => {
    expect(effortFraction({ efforts: [EEffort.High], value: EEffort.High })).toBe(1)
  })
})

describe('effortArc', () => {
  const flagsOf = (path: string) => path.split(' A ')[1]?.split(' ').slice(3, 5).join(' ')

  it('starts and ends on the same point when empty', () => {
    const [start] = effortArc({ fraction: 0 }).split(' A ')
    expect(start).toBe('M 5.64 18.36')
  })

  it('keeps the small-arc flag until the sweep passes a half turn', () => {
    expect(flagsOf(effortArc({ fraction: 0.5 }))).toBe('0 1')
    expect(flagsOf(effortArc({ fraction: 0.9 }))).toBe('1 1')
  })
})

describe('effortNeedleDegrees', () => {
  it('turns the needle from lower-left to lower-right through straight up', () => {
    expect(effortNeedleDegrees({ fraction: 0 })).toBe(-135)
    expect(effortNeedleDegrees({ fraction: 0.5 })).toBe(0)
    expect(effortNeedleDegrees({ fraction: 1 })).toBe(135)
  })
})

describe('EffortDial', () => {
  it('shows the effort word on the trigger only when asked', () => {
    const plain = renderToStaticMarkup(<EffortDial efforts={EFFORTS} value={EEffort.High} />)
    const labelled = renderToStaticMarkup(
      <EffortDial efforts={EFFORTS} value={EEffort.High} showEffortLabel />,
    )

    expect(plain).not.toContain('>High<')
    expect(labelled).toContain('>High<')
  })
})

describe('effortTickLeft', () => {
  it('insets the first and last ticks by half a thumb', () => {
    expect(effortTickLeft({ index: 0, last: 4 })).toBe('calc(9px + (100% - 18px) * 0)')
    expect(effortTickLeft({ index: 2, last: 4 })).toBe('calc(9px + (100% - 18px) * 0.5)')
    expect(effortTickLeft({ index: 4, last: 4 })).toBe('calc(9px + (100% - 18px) * 1)')
  })
})

describe('EffortGauge', () => {
  it('draws the track and the needle', () => {
    const html = renderToStaticMarkup(
      <EffortGauge efforts={EFFORTS} value={EEffort.High} className="size-4" />,
    )

    expect(html.match(/<path/g)).toHaveLength(2)
    expect(html).toContain('M 12 12 L 12 6.5')
    expect(html).toContain('transform:rotate(0deg)')
    expect(html).toContain('class="size-4"')
  })

  it('sweeps the needle to the left end at the lowest rung', () => {
    const html = renderToStaticMarkup(<EffortGauge efforts={EFFORTS} value={EEffort.Low} />)

    expect(html).toContain('transform:rotate(-135deg)')
  })

  it('animates the needle between rungs unless the reader asks for less motion', () => {
    const html = renderToStaticMarkup(<EffortGauge efforts={EFFORTS} value={EEffort.High} />)

    expect(html).toContain('transition-transform')
    expect(html).toContain('motion-reduce:transition-none')
  })
})

describe('EffortDial', () => {
  it('names the level in the trigger', () => {
    const html = renderToStaticMarkup(<EffortDial efforts={EFFORTS} value={EEffort.High} />)

    expect(html).toContain('data-slot="model-effort"')
    expect(html).toContain('aria-label="Effort: High"')
    expect(html).toContain('title="Effort: High"')
  })

  it('carries no label text of its own', () => {
    const html = renderToStaticMarkup(<EffortDial efforts={EFFORTS} value={EEffort.High} />)

    expect(html).not.toContain('>High<')
  })
})

describe('EffortDial labels', () => {
  const NATIVE = {
    [EEffort.Off]: 'None',
    [EEffort.Low]: 'Low',
    [EEffort.High]: 'High',
    [EEffort.Max]: 'Max',
  }

  it("names the rung in the model's own words", () => {
    const html = renderToStaticMarkup(
      <EffortDial efforts={EFFORTS} value={EEffort.High} labels={NATIVE} />,
    )

    expect(html).toContain('aria-label="Effort: High"')
    expect(html).toContain('title="Effort: High"')
  })

  it('falls back per rung to the Atlas label', () => {
    const html = renderToStaticMarkup(
      <EffortDial efforts={EFFORTS} value={EEffort.XHigh} labels={NATIVE} />,
    )

    expect(html).toContain('aria-label="Effort: Extra high"')
  })
})

describe('EffortDial read-only', () => {
  it('keeps the gauge but disables the slider without an onChange', () => {
    const html = renderToStaticMarkup(<EffortDial efforts={EFFORTS} value={EEffort.High} />)

    expect(html).toContain('data-slot="model-effort"')
    expect(html).toContain('data-read-only')
  })

  it('leaves the trigger interactive when it can change effort', () => {
    const html = renderToStaticMarkup(
      <EffortDial efforts={EFFORTS} value={EEffort.High} onChange={() => undefined} />,
    )

    expect(html).not.toContain('data-read-only')
  })
})
