import { describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION, UNSTAMPED_PROTOCOL } from '@dltech/atlas-wire'

import { parseInstalledStamps, serveDriftedFor, serveStaleFor } from '../serve-drift'

const current = { version: '1.2.3', protocol: CHANNEL_PROTOCOL_VERSION }

describe('parseInstalledStamps', () => {
  it('reads the version then the protocol line', () => {
    expect(parseInstalledStamps(`1.2.3\n${CHANNEL_PROTOCOL_VERSION}\n`)).toEqual(current)
  })

  it('treats empty and malformed stamps as unstamped', () => {
    expect(parseInstalledStamps('\n\n')).toEqual({
      version: undefined,
      protocol: UNSTAMPED_PROTOCOL,
    })
    expect(parseInstalledStamps('1.2.3\nnope\n')).toEqual({
      version: '1.2.3',
      protocol: UNSTAMPED_PROTOCOL,
    })
    expect(parseInstalledStamps('')).toEqual({ version: undefined, protocol: UNSTAMPED_PROTOCOL })
  })
})

describe('serveDriftedFor', () => {
  it('drifts on a stamped protocol that is not the current one', () => {
    expect(
      serveDriftedFor({
        stamps: { version: '1.2.3', protocol: CHANNEL_PROTOCOL_VERSION - 1 },
        desiredVersion: undefined,
      }),
    ).toBe(true)
  })

  it('does not drift on an unstamped protocol', () => {
    expect(
      serveDriftedFor({
        stamps: { version: undefined, protocol: UNSTAMPED_PROTOCOL },
        desiredVersion: '9.9.9',
      }),
    ).toBe(false)
  })

  it('drifts on a stamped version the pin disagrees with, never on an unstamped one', () => {
    expect(serveDriftedFor({ stamps: current, desiredVersion: '2.0.0' })).toBe(true)
    expect(serveDriftedFor({ stamps: current, desiredVersion: '1.2.3' })).toBe(false)
    expect(serveDriftedFor({ stamps: current, desiredVersion: undefined })).toBe(false)
    expect(
      serveDriftedFor({
        stamps: { version: undefined, protocol: CHANNEL_PROTOCOL_VERSION },
        desiredVersion: '2.0.0',
      }),
    ).toBe(false)
  })
})

describe('serveStaleFor', () => {
  it('is stale whenever the binary is absent', () => {
    expect(serveStaleFor({ present: false, stamps: current, desiredVersion: '1.2.3' })).toBe(true)
  })

  it('is stale when a present binary carries no version matching the pin', () => {
    expect(
      serveStaleFor({
        present: true,
        stamps: { version: undefined, protocol: UNSTAMPED_PROTOCOL },
        desiredVersion: '1.2.3',
      }),
    ).toBe(true)
  })

  it('is fresh when version and protocol agree', () => {
    expect(serveStaleFor({ present: true, stamps: current, desiredVersion: '1.2.3' })).toBe(false)
  })

  it('is stale on protocol drift even without a pin', () => {
    expect(
      serveStaleFor({
        present: true,
        stamps: { version: undefined, protocol: CHANNEL_PROTOCOL_VERSION + 1 },
        desiredVersion: undefined,
      }),
    ).toBe(true)
  })
})
