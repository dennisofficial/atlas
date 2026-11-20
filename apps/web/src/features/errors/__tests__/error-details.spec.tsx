import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { CloudApiError } from '@/lib/cloud-api'

import { ErrorDetails } from '../error-details'

const render = (error: Error & { digest?: string }): string =>
  renderToStaticMarkup(<ErrorDetails error={error} />)

describe('ErrorDetails', () => {
  it('shows the error name and message in monospace', () => {
    const html = render(new TypeError('r.map is not a function'))

    expect(html).toContain('TypeError: r.map is not a function')
    expect(html).toContain('font-mono')
  })

  it('shows a generated reference id the exception event also carries', () => {
    const html = render(new Error('boom'))
    expect(html).toMatch(/err_[0-9a-f]{12}/)
  })

  it('shows the server digest in place of a generated id', () => {
    const error = Object.assign(new Error('boom'), { digest: '381726354' })
    const html = render(error)

    expect(html).toContain('381726354')
    expect(html).not.toMatch(/err_[0-9a-f]{12}/)
  })

  it('shows the API request id when the crash came from a failed call', () => {
    const html = render(new CloudApiError({ message: 'boom', status: 500, requestId: 'req_abc' }))
    expect(html).toContain('Request req_abc')
  })

  it('truncates a very long message', () => {
    const html = render(new Error('x'.repeat(1000)))
    expect(html.length).toBeLessThan(2000)
    expect(html).toContain('…')
  })

  it('offers a copy affordance', () => {
    expect(render(new Error('boom'))).toContain('Copy details')
  })
})
