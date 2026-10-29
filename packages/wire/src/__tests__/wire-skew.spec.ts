import { describe, expect, it } from 'bun:test'

import { skewViolations, wireFactsOf } from '../wire-skew'

const wire = (args: { version: number; min?: number; requests: string[] }): string =>
  [
    `export const CHANNEL_PROTOCOL_VERSION = ${args.version}`,
    args.min === undefined ? '' : `export const CHANNEL_PROTOCOL_MIN_VERSION = ${args.min}`,
    `export enum EClientRequest {\n${args.requests.map((op) => `  X${op} = '${op}',`).join('\n')}\n}`,
  ].join('\n')

const violationsOf = (args: { base: string; head: string }) =>
  skewViolations({ base: wireFactsOf(args.base), head: wireFactsOf(args.head) })

describe('skewViolations', () => {
  it('passes an additive request with no bump', () => {
    expect(
      violationsOf({
        base: wire({ version: 30, requests: ['a'] }),
        head: wire({ version: 30, min: 29, requests: ['a', 'b'] }),
      }),
    ).toEqual([])
  })

  it('passes a bump that keeps the previous protocol as the minimum', () => {
    expect(
      violationsOf({
        base: wire({ version: 30, min: 29, requests: ['a'] }),
        head: wire({ version: 31, min: 30, requests: ['a'] }),
      }),
    ).toEqual([])
  })

  it('fails a bump that drops the protocol the last build spoke', () => {
    const [violation] = violationsOf({
      base: wire({ version: 29, requests: ['a'] }),
      head: wire({ version: 30, requests: ['a', 'new-op'] }),
    })
    expect(violation).toContain('drops protocol 29')
  })

  it('fails a removed request without a bump', () => {
    const [violation] = violationsOf({
      base: wire({ version: 30, min: 29, requests: ['a', 'b'] }),
      head: wire({ version: 30, min: 29, requests: ['a'] }),
    })
    expect(violation).toContain('lost b')
  })
})
