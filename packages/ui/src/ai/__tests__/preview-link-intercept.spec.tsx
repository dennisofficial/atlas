import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MessageResponse } from '../message-response'

describe('MessageResponse onLinkClick', () => {
  it('renders an ordinary anchor that still opens in a new tab', () => {
    const html = renderToStaticMarkup(
      <MessageResponse onLinkClick={() => undefined}>{'[x](https://x.test)'}</MessageResponse>,
    )
    expect(html).toContain('href="https://x.test/"')
    expect(html).toContain('target="_blank"')
  })
})
