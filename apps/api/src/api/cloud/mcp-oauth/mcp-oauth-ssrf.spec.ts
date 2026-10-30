import { describe, expect, it } from 'bun:test'
import { assertPublicHost, assertPublicUrl, SsrfRejectedError } from './mcp-oauth-ssrf'

const blocked = (url: string) =>
  expect(() => assertPublicUrl({ url, allowLocalTargets: false })).toThrow(SsrfRejectedError)

describe('assertPublicUrl literals', () => {
  it('blocks private and special IPv4', () => {
    for (const host of [
      '198.18.0.1',
      '198.19.255.255',
      '192.0.0.8',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '10.1.1.1',
      '100.64.0.1',
    ]) {
      blocked(`https://${host}/x`)
    }
  })

  it('blocks special IPv6 ranges', () => {
    for (const host of [
      '[::1]',
      '[::]',
      '[::7f00:1]',
      '[::ffff:127.0.0.1]',
      '[::ffff:7f00:1]',
      '[64:ff9b::7f00:1]',
      '[2002:7f00:1::]',
      '[fec0::1]',
      '[ff02::1]',
      '[fe80::1]',
      '[fd00::1]',
    ]) {
      blocked(`https://${host}/x`)
    }
  })

  it('blocks a trailing-dot localhost', () => {
    blocked('https://localhost./x')
  })

  it('allows public literals and local targets in the local tier', () => {
    expect(() =>
      assertPublicUrl({ url: 'https://93.184.216.34/x', allowLocalTargets: false }),
    ).not.toThrow()
    expect(() =>
      assertPublicUrl({ url: 'http://localhost:3000/x', allowLocalTargets: true }),
    ).not.toThrow()
  })
})

describe('assertPublicHost DNS', () => {
  const check = (addresses: string[]) =>
    assertPublicHost({
      url: 'https://mcp.example.com/mcp',
      allowLocalTargets: false,
      resolveHost: async () => addresses,
    })

  it('rejects when any resolved address is private', async () => {
    await expect(check(['93.184.216.34', '10.0.0.5'])).rejects.toBeInstanceOf(SsrfRejectedError)
  })
  it('rejects an empty resolution', async () => {
    await expect(check([])).rejects.toBeInstanceOf(SsrfRejectedError)
  })
  it('accepts public addresses', async () => {
    await expect(check(['93.184.216.34', '2606:2800:220:1::1'])).resolves.toBeUndefined()
  })
  it('skips DNS in the local tier', async () => {
    await expect(
      assertPublicHost({
        url: 'http://localhost/x',
        allowLocalTargets: true,
        resolveHost: async () => {
          throw new Error('should not resolve')
        },
      }),
    ).resolves.toBeUndefined()
  })
})
