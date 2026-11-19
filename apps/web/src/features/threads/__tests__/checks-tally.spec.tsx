import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChecksTally, checksTallyLabelOf } from '../checks-tally'

describe('ChecksTally', () => {
  it('renders the waiting count before the muted clock', () => {
    const html = renderToStaticMarkup(
      <ChecksTally checks={{ running: 0, passed: 0, failed: 0, expected: 2 }} />,
    )

    expect(html).toContain('aria-label="0 running, 0 passed, 0 failed, 2 waiting"')
    expect(html).toMatch(/text-muted-foreground[^<]*>2<svg[^>]*lucide-clock/)
  })

  it('renders each count before its icon and no clock when nothing waits', () => {
    const html = renderToStaticMarkup(
      <ChecksTally checks={{ running: 1, passed: 2, failed: 3, expected: 0 }} />,
    )

    expect(html).not.toContain('lucide-clock')
    expect(html).toContain('aria-label="1 running, 2 passed, 3 failed"')
    expect(html).toMatch(/text-warning[^<]*>1<svg/)
    expect(html).toMatch(/text-success[^<]*>2<svg[^<]*lucide-check/)
    expect(html).toMatch(/text-destructive[^<]*>3<svg[^<]*lucide-x/)
  })

  it('labels a waiting tally with its count', () => {
    expect(checksTallyLabelOf({ running: 0, passed: 0, failed: 0, expected: 2 })).toBe(
      '0 running, 0 passed, 0 failed, 2 waiting',
    )
    expect(checksTallyLabelOf({ running: 1, passed: 2, failed: 0, expected: 0 })).toBe(
      '1 running, 2 passed, 0 failed',
    )
  })
})
