import { describe, expect, it } from 'bun:test'

import { capabilitiesSchema, ECapability } from '../capabilities'
import {
  CHANNEL_PROTOCOL_MIN_VERSION,
  CHANNEL_PROTOCOL_VERSION,
  EClientFrame,
  EProtocolSkew,
  protocolSkewOf,
  unreadableRequestIdOf,
} from '../channel-wire'

describe('protocolSkewOf', () => {
  it('accepts a peer that predates protocol stamping', () => {
    expect(protocolSkewOf({})).toBe(EProtocolSkew.Compatible)
  })

  it('accepts every protocol from the minimum to the current one', () => {
    for (
      let protocol = CHANNEL_PROTOCOL_MIN_VERSION;
      protocol <= CHANNEL_PROTOCOL_VERSION;
      protocol++
    ) {
      expect(protocolSkewOf({ protocol })).toBe(EProtocolSkew.Compatible)
    }
  })

  it('refuses a peer older than the minimum', () => {
    expect(protocolSkewOf({ protocol: CHANNEL_PROTOCOL_MIN_VERSION - 1 })).toBe(
      EProtocolSkew.PeerTooOld,
    )
  })

  it('accepts a newer peer that still speaks this protocol', () => {
    expect(
      protocolSkewOf({
        protocol: CHANNEL_PROTOCOL_VERSION + 3,
        minProtocol: CHANNEL_PROTOCOL_VERSION,
      }),
    ).toBe(EProtocolSkew.Compatible)
  })

  it('refuses a newer peer whose minimum is past this protocol', () => {
    expect(protocolSkewOf({ protocol: CHANNEL_PROTOCOL_VERSION + 1 })).toBe(
      EProtocolSkew.PeerTooNew,
    )
  })
})

describe('capabilitiesSchema', () => {
  it('drops capabilities this build does not know instead of failing', () => {
    expect(
      capabilitiesSchema.parse([ECapability.SandboxSessionIdentity, 'from-the-future']),
    ).toEqual([ECapability.SandboxSessionIdentity])
  })
})

describe('unreadableRequestIdOf', () => {
  it('reads the id of a request with an unknown op', () => {
    const raw = JSON.stringify({ kind: EClientFrame.Request, id: 'r1', op: 'new-op', params: {} })
    expect(unreadableRequestIdOf(raw)).toBe('r1')
  })

  it('answers null for anything that is not a request', () => {
    expect(unreadableRequestIdOf('not json')).toBeNull()
    expect(unreadableRequestIdOf(JSON.stringify({ kind: EClientFrame.Pong }))).toBeNull()
  })
})
