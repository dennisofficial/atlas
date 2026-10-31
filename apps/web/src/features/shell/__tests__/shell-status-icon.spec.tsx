import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ThreadStatusIcon } from '../shell-status-icon'
import { EThreadStatus } from '../thread-status'

const iconOf = (status: EThreadStatus) => renderToStaticMarkup(<ThreadStatusIcon status={status} />)

describe('ThreadStatusIcon', () => {
  for (const [status, label, icon, spinning] of [
    [EThreadStatus.Running, 'Working', 'lucide-loader-circle', true],
    [EThreadStatus.Awaiting, 'Waiting for you', 'lucide-circle-alert', false],
    [EThreadStatus.Starting, 'Starting pod', 'lucide-circle-dashed', true],
    [EThreadStatus.Failed, 'Failed', 'lucide-circle-x', false],
    [EThreadStatus.Idle, 'Idle', 'lucide-circle', false],
    [EThreadStatus.Parked, 'Parked', 'lucide-circle-dashed', false],
  ] as const) {
    it(`distinguishes ${label} by an accessible label, shape and animation`, () => {
      const html = iconOf(status)
      expect(html).toContain('role="img"')
      expect(html).toContain(`aria-label="${label}"`)
      expect(html).toContain(icon)
      expect(html.includes('animate-spin')).toBe(spinning)
      expect(html.includes('motion-reduce:animate-none')).toBe(spinning)
    })
  }

  it('keeps idle solid while parked and starting use a dashed ring', () => {
    expect(iconOf(EThreadStatus.Idle)).not.toContain('lucide-circle-dashed')
    expect(iconOf(EThreadStatus.Parked)).toContain('text-muted-foreground/60')
  })

  it('retains legacy PR icon consumers and forwards sizing classes', () => {
    for (const status of [EThreadStatus.PrOpen, EThreadStatus.PrMerged, EThreadStatus.PrClosed]) {
      expect(iconOf(status)).toContain('aria-label="Pull request')
    }
    const html = renderToStaticMarkup(
      <ThreadStatusIcon status={EThreadStatus.Idle} className="size-3.5" />,
    )
    expect(html).toContain('size-3.5')
    expect(html).not.toContain('size-4 ')
  })
})
