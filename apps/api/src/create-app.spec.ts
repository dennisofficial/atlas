import { describe, expect, it } from 'bun:test'
import { originAllowed } from './create-app'

const trustedOrigins = new Set([
  'http://localhost:8081',
  'https://app.byatlas.io',
  'http://localhost:3001',
])
const agentOrigins = ['https://agent.byatlas.io']

const allowed = (origin: string | undefined): boolean =>
  originAllowed({ origin, trustedOrigins, agentOrigins })

describe('createApp CORS allowlist', () => {
  it('allows a trusted origin', () => {
    expect(allowed('http://localhost:8081')).toBe(true)
  })

  it('allows the web origin', () => {
    expect(allowed('http://localhost:3001')).toBe(true)
  })

  it('allows an origin the agent lists', () => {
    expect(allowed('https://agent.byatlas.io')).toBe(true)
  })

  it('does not allow an untrusted origin', () => {
    expect(allowed('https://evil.test')).toBe(false)
  })

  it('allows a request without an origin', () => {
    expect(allowed(undefined)).toBe(true)
  })
})
