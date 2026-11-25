import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Input } from '../input'

describe('Input', () => {
  it('small carries its own height', () => {
    const html = renderToStaticMarkup(<Input size="sm" aria-label="Message" />)

    expect(html).toContain('data-size="sm"')
    expect(html).toContain('data-[size=sm]:h-7')
  })
})
