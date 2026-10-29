import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ENoticeTone, HarnessNotice } from '../harness-notice'

describe('HarnessNotice', () => {
  it('shows the empty note inline and no expander when there is no body', () => {
    const html = renderToStaticMarkup(
      <HarnessNotice title="PR #1: merged" tone={ENoticeTone.Ok} body="" emptyNote="no body" />,
    )

    expect(html).toContain('no body')
    expect(html).not.toContain('trace-collapsible-trigger')
  })

  it('offers an expander and hides the empty note when there is a body', () => {
    const html = renderToStaticMarkup(
      <HarnessNotice
        title="exited"
        tone={ENoticeTone.Failed}
        body="boom"
        emptyNote="printed nothing"
      />,
    )

    expect(html).toContain('trace-collapsible-trigger')
    expect(html).not.toContain('printed nothing')
  })
})
