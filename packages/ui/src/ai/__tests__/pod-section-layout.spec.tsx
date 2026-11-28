import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { POD_SECTION_SHAPE, POD_SECTION_SHAPES } from '../pod-metrics.fixtures'
import { PodSection, type PodSectionProps } from '../pod-section'
import { EPodState } from '../pod-status'

const BASE: PodSectionProps = {
  state: EPodState.Running,
  shape: POD_SECTION_SHAPE,
  shapes: POD_SECTION_SHAPES,
  commandRamLimitGb: 7,
  series: [{ t: 1, cpu: 35, ramGb: 2.5, diskUsedGb: 12, diskLimitGb: 20 }],
}

function htmlOf(overrides: Partial<PodSectionProps> = {}): string {
  return renderToStaticMarkup(<PodSection {...BASE} {...overrides} />)
}

describe('pod section vertical layout', () => {
  it('puts a full-width spark above the metric list', () => {
    const html = htmlOf()
    expect(html).toContain('relative h-8 w-full')
    expect(html.indexOf('data-slot="pod-spark-plot"')).toBeLessThan(html.indexOf('>CPU</span>'))
    expect(html).not.toContain('grid-cols-[1rem_minmax(0,1fr)_auto]')
  })

  it('keeps the whole RAM value and command limit visible without truncation', () => {
    const html = htmlOf()
    const value = html.match(
      /<span class="([^"]*)">2\.5 \/ 16 GB<span class="block text-\[11px\] text-muted-foreground">commands ≤ 7 GB<\/span><\/span>/,
    )
    expect(html).not.toContain('·')
    expect(value).not.toBeNull()
    expect(value?.[1]).toContain('tabular-nums')
    expect(value?.[1]).toContain('wrap-anywhere')
    expect(value?.[1]).not.toMatch(/truncate|line-clamp|overflow-hidden|whitespace-nowrap/)
  })

  it('gives idle and unavailable charts the same full-width space above the list', () => {
    for (const overrides of [
      { state: EPodState.Stopped },
      { series: [] },
      { series: [], usageUnavailable: true },
    ]) {
      const html = htmlOf(overrides)
      expect(html).toContain('flex h-8 w-full')
      expect(html.indexOf('role="img"')).toBeLessThan(html.indexOf('>CPU</span>'))
    }
  })

  it('shows the current disk size on the trigger after the disk value, like the pod size', () => {
    const html = htmlOf({ diskGrow: true })
    const trigger = html.match(/<button[^>]*aria-label="Disk size"[^>]*>/)?.[0]
    expect(trigger).not.toContain('data-variant="ghost"')
    expect(html.indexOf('12 / 20 GB')).toBeLessThan(html.indexOf('aria-label="Disk size"'))
    expect(html).toMatch(/data-slot="select-value"[^>]*>20 GB<\/span>/)
  })

  it('aligns signals and resize status with the metric text after the swatch', () => {
    const html = htmlOf({ throttled: true, oomEvents: 1 })
    expect(html).toContain('flex flex-col gap-2 pl-4')
    expect(html).toContain('Throttled')
    expect(html).toContain('1 out-of-memory kill')
    expect(html).not.toContain('pl-[1.625rem]')
  })
})
