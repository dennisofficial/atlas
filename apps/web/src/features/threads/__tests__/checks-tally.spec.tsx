import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChecksTally, checksTallyLabelOf } from '../checks-tally'

describe('ChecksTally', () => {
  it('renders the muted waiting clock with no number before the counts', () => {
    const html = renderToStaticMarkup(
      <ChecksTally checks={{ running: 0, passed: 0, failed: 0, waiting: true }} />,
    )

    expect(html).toContain('aria-label="waiting for checks, 0 running, 0 passed, 0 failed"')
    expect(html).toContain('lucide-clock')
    expect(html).toContain('text-muted-foreground')
  })

  it('renders no waiting clock when a count is known', () => {
    const html = renderToStaticMarkup(
      <ChecksTally checks={{ running: 1, passed: 2, failed: 0, waiting: false }} />,
    )

    expect(html).not.toContain('lucide-clock')
    expect(html).toContain('aria-label="1 running, 2 passed, 0 failed"')
  })

  it('labels a waiting tally without changing the counts', () => {
    expect(checksTallyLabelOf({ running: 0, passed: 0, failed: 0, waiting: true })).toBe(
      'waiting for checks, 0 running, 0 passed, 0 failed',
    )
  })
})
