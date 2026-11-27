import { describe, expect, it } from 'bun:test'

import { EReturnResult, LOOPBACK_PATH, loopbackReplyOf, loopbackRequestOk } from '..'

const PORT = 53682

const STATE = 'state-1'

const REQUEST = {
  method: 'GET',
  address: '127.0.0.1',
  url: `http://127.0.0.1:${PORT}/desktop/auth/callback?code=code-1&state=${STATE}`,
  port: PORT,
  path: '/desktop/auth/callback',
}

describe('a loopback request', () => {
  it('accepts a GET on loopback for the bound port and the flow path', () => {
    expect(loopbackRequestOk(REQUEST)).toBe(true)
    expect(loopbackRequestOk({ ...REQUEST, address: '::ffff:127.0.0.1' })).toBe(true)
    expect(loopbackRequestOk({ ...REQUEST, path: LOOPBACK_PATH })).toBe(false)
  })

  it('refuses another method, peer, host, port or path', () => {
    expect(loopbackRequestOk({ ...REQUEST, method: 'POST' })).toBe(false)
    expect(loopbackRequestOk({ ...REQUEST, address: undefined })).toBe(false)
    expect(loopbackRequestOk({ ...REQUEST, address: '10.0.0.7' })).toBe(false)
    expect(
      loopbackRequestOk({
        ...REQUEST,
        url: `http://attacker.example:${PORT}/desktop/auth/callback?code=code-1`,
      }),
    ).toBe(false)
    expect(
      loopbackRequestOk({
        ...REQUEST,
        url: `http://127.0.0.1:${PORT + 1}/desktop/auth/callback?code=code-1`,
      }),
    ).toBe(false)
    expect(loopbackRequestOk({ ...REQUEST, path: '/atlas-return' })).toBe(false)
    expect(loopbackRequestOk({ ...REQUEST, url: 'not a url' })).toBe(false)
  })
})

describe('a framework return on the loopback', () => {
  const returned = (url: string) =>
    loopbackReplyOf({ method: 'GET', address: '127.0.0.1', url, port: PORT, state: STATE })

  it('carries the outcome when the state matches', () => {
    expect(
      returned(`http://127.0.0.1:${PORT}/atlas-return?atlasReturn=connected&atlasState=${STATE}`),
    ).toEqual({ accepted: true, outcome: { result: EReturnResult.Connected } })
  })

  it('keeps waiting for another state or a request that is not a return', () => {
    expect(
      returned(`http://127.0.0.1:${PORT}/atlas-return?atlasReturn=connected&atlasState=state-2`),
    ).toEqual({ accepted: false })
    expect(returned(`http://127.0.0.1:${PORT}/atlas-return`)).toEqual({ accepted: false })
  })
})
