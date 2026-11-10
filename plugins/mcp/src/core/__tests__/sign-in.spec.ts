import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '@dltech/atlas-core'

import { EMcpViewStatus } from '../row'
import {
  EMcpSignInResult,
  LINK_EXPIRED_REASON,
  mcpSignInResolvedSchema,
  mcpSignInStartedSchema,
  signInResolutionsOf,
} from '../sign-in'

const rowOf = (args: {
  status: EMcpViewStatus
  reason?: string
}): {
  name: string
  transport: 'http'
  status: EMcpViewStatus
  toolCount: number
  reason?: string
  layer: EDefinitionOrigin
} => ({
  name: 'posthog',
  transport: 'http',
  status: args.status,
  toolCount: 0,
  ...(args.reason === undefined ? {} : { reason: args.reason }),
  layer: EDefinitionOrigin.User,
})

const NOW = Date.parse('2026-11-10T12:00:00.000Z')

const resolve = (args: {
  pending?: readonly { server: string; expiresAt?: string }[]
  rows: readonly ReturnType<typeof rowOf>[]
}) =>
  signInResolutionsOf({
    sessionId: 's1',
    pending: args.pending ?? [{ server: 'posthog', expiresAt: '2026-11-10T12:10:00.000Z' }],
    rows: args.rows,
    now: NOW,
  })

describe('the sign-in card events', () => {
  it('parses a started card and its resolution', () => {
    expect(
      mcpSignInStartedSchema.parse({
        type: 'mcp-sign-in-started',
        server: 'posthog',
        url: 'https://provider.test/authorize?client_id=c',
        expiresAt: '2026-11-10T12:10:00.000Z',
        sessionId: 's1',
      }),
    ).toEqual({
      type: 'mcp-sign-in-started',
      server: 'posthog',
      url: 'https://provider.test/authorize?client_id=c',
      expiresAt: '2026-11-10T12:10:00.000Z',
      sessionId: 's1',
    })
    expect(
      mcpSignInResolvedSchema.parse({
        type: 'mcp-sign-in-resolved',
        server: 'posthog',
        result: EMcpSignInResult.Connected,
        sessionId: 's1',
      }),
    ).toEqual({
      type: 'mcp-sign-in-resolved',
      server: 'posthog',
      result: EMcpSignInResult.Connected,
      sessionId: 's1',
    })
  })

  it('refuses a resolution that is neither connected nor failed', () => {
    expect(
      mcpSignInResolvedSchema.safeParse({
        type: 'mcp-sign-in-resolved',
        server: 'posthog',
        result: 'pending',
      }).success,
    ).toBe(false)
  })
})

describe('resolving a sign-in the session started', () => {
  it('says connected once the row connects, and stops waiting', () => {
    expect(resolve({ rows: [rowOf({ status: EMcpViewStatus.Connected })] })).toEqual({
      resolved: [
        {
          type: 'mcp-sign-in-resolved',
          server: 'posthog',
          result: EMcpSignInResult.Connected,
          sessionId: 's1',
        },
      ],
      outstanding: [],
    })
  })

  it('carries the row reason when the row failed', () => {
    const rows = [rowOf({ status: EMcpViewStatus.Failed, reason: 'token exchange failed' })]

    expect(resolve({ rows })).toEqual({
      resolved: [
        {
          type: 'mcp-sign-in-resolved',
          server: 'posthog',
          result: EMcpSignInResult.Failed,
          sessionId: 's1',
          reason: 'token exchange failed',
        },
      ],
      outstanding: [],
    })
  })

  it('keeps waiting while the row still needs a sign-in', () => {
    expect(resolve({ rows: [rowOf({ status: EMcpViewStatus.NeedsAuth })] })).toEqual({
      resolved: [],
      outstanding: [{ server: 'posthog', expiresAt: '2026-11-10T12:10:00.000Z' }],
    })
  })

  it('keeps waiting when the row is gone but the link is still live', () => {
    expect(resolve({ rows: [] })).toEqual({
      resolved: [],
      outstanding: [{ server: 'posthog', expiresAt: '2026-11-10T12:10:00.000Z' }],
    })
  })

  it('keeps waiting when the host did not say when the link dies', () => {
    expect(resolve({ pending: [{ server: 'posthog' }], rows: [] })).toEqual({
      resolved: [],
      outstanding: [{ server: 'posthog' }],
    })
  })

  it('fails the card once the link it handed out has expired', () => {
    expect(
      resolve({ pending: [{ server: 'posthog', expiresAt: '2026-11-10T11:59:00.000Z' }], rows: [] }),
    ).toEqual({
      resolved: [
        {
          type: 'mcp-sign-in-resolved',
          server: 'posthog',
          result: EMcpSignInResult.Failed,
          sessionId: 's1',
          reason: LINK_EXPIRED_REASON,
        },
      ],
      outstanding: [],
    })
  })

  it('resolves each server on its own row', () => {
    const outcome = signInResolutionsOf({
      sessionId: 's1',
      pending: [
        { server: 'posthog', expiresAt: '2026-11-10T12:10:00.000Z' },
        { server: 'linear', expiresAt: '2026-11-10T12:10:00.000Z' },
      ],
      rows: [
        rowOf({ status: EMcpViewStatus.NeedsAuth }),
        {
          name: 'linear',
          transport: 'http',
          status: EMcpViewStatus.Connected,
          toolCount: 3,
          layer: EDefinitionOrigin.User,
        },
      ],
      now: NOW,
    })

    expect(outcome.resolved).toEqual([
      {
        type: 'mcp-sign-in-resolved',
        server: 'linear',
        result: EMcpSignInResult.Connected,
        sessionId: 's1',
      },
    ])
    expect(outcome.outstanding).toEqual([
      { server: 'posthog', expiresAt: '2026-11-10T12:10:00.000Z' },
    ])
  })
})
