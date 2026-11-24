import { describe, expect, it } from 'bun:test'

import { statusFailureOf } from '../fetch-page'

const failureFor = (status: number, statusText: string): string =>
  statusFailureOf({ host: 'example.com', response: new Response(null, { status, statusText }) })

describe('statusFailureOf', () => {
  it('points a refused reader at the browser tool', () => {
    expect(failureFor(403, 'Forbidden')).toBe(
      'example.com answered 403 Forbidden. It refuses automated readers, so try the browser tool.',
    )
  })

  it('points a missing page at web_search', () => {
    expect(failureFor(404, 'Not Found')).toBe(
      'example.com answered 404 Not Found. The page does not exist, so find the right url with web_search rather than guessing another.',
    )
  })

  it('names any other status alone', () => {
    expect(failureFor(503, 'Service Unavailable')).toBe(
      'example.com answered 503 Service Unavailable',
    )
  })
})
