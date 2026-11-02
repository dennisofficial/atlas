import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MessageResponse } from '../message-response'
import { PreviewFrame } from '../preview-frame'
import { EPreviewStatus } from '../preview-ports'

const ports = [
  { id: 'a', port: 3000, label: 'Web', url: 'https://a.test', status: EPreviewStatus.Live },
]

describe('PreviewFrame src override', () => {
  it('embeds the override instead of the port url', () => {
    const html = renderToStaticMarkup(
      <PreviewFrame ports={ports} onSelect={() => undefined} src="https://a.test/docs?q=1" />,
    )
    expect(html).toContain('src="https://a.test/docs?q=1"')
    expect(html).toContain('href="https://a.test/docs?q=1"')
  })
})

describe('MessageResponse onLinkClick', () => {
  it('renders an ordinary anchor that still opens in a new tab', () => {
    const html = renderToStaticMarkup(
      <MessageResponse onLinkClick={() => undefined}>{'[x](https://x.test)'}</MessageResponse>,
    )
    expect(html).toContain('href="https://x.test/"')
    expect(html).toContain('target="_blank"')
  })
})
