import type { V2Event } from '@dltech/atlas-core'
import { EAuthor, EEntryKind } from '@dltech/atlas-client/transcript'
import { describe, expect, it } from 'bun:test'

import { EMcpSignInResult } from '../../core/sign-in'
import { mcpSignInEntries } from '../sign-in-entry'

const URL = 'https://provider.test/authorize?client_id=c&code_challenge=xyz'

const stamp = (body: Record<string, unknown>, n: number): V2Event =>
  ({
    ...body,
    seq: n,
    at: `2026-11-10T12:00:0${n}.000Z`,
    threadId: 't1',
    id: `e${n}`,
  }) as unknown as V2Event

const started = (n = 1, extra: Record<string, unknown> = {}): V2Event =>
  stamp(
    {
      type: 'mcp-sign-in-started',
      server: 'posthog',
      url: URL,
      expiresAt: '2026-11-10T12:10:00.000Z',
      sessionId: 's1',
      ...extra,
    },
    n,
  )

const resolved = (n = 2, extra: Record<string, unknown> = {}): V2Event =>
  stamp(
    {
      type: 'mcp-sign-in-resolved',
      server: 'posthog',
      result: EMcpSignInResult.Connected,
      sessionId: 's1',
      ...extra,
    },
    n,
  )

const entryOf = (events: readonly V2Event[]) => {
  const [entry] = [...mcpSignInEntries(events).values()]
  if (entry === undefined) throw new Error('no sign-in entry was built')
  return entry
}

describe('the sign-in card as a transcript row', () => {
  it('draws the card from the event that opened it', () => {
    expect(entryOf([started()])).toEqual({
      kind: EEntryKind.SignIn,
      author: EAuthor.Model,
      key: 'e1',
      text: `sign in to the posthog MCP server: ${URL}`,
      subject: 'posthog',
      url: URL,
      expiresAt: '2026-11-10T12:10:00.000Z',
    })
  })

  it('redraws the same row as signed in once the resolution lands', () => {
    const entries = mcpSignInEntries([started(), resolved()])

    expect([...entries.keys()]).toEqual(['e1'])
    expect(entries.get('e1')?.text).toBe('signed in to the posthog MCP server')
    expect(entries.get('e1')?.result).toBe(EMcpSignInResult.Connected)
  })

  it('says why the sign-in failed', () => {
    const entries = mcpSignInEntries([
      started(),
      resolved(2, {
        result: EMcpSignInResult.Failed,
        reason: 'the provider refused the code',
      }),
    ])

    expect(entries.get('e1')?.text).toBe(
      'signing in to the posthog MCP server failed: the provider refused the code',
    )
    expect(entries.get('e1')?.reason).toBe('the provider refused the code')
  })

  it('draws nothing for a resolution whose card it never saw', () => {
    expect(mcpSignInEntries([resolved()]).size).toBe(0)
  })

  it('keeps two servers apart in one session', () => {
    const entries = mcpSignInEntries([
      started(1),
      started(2, { server: 'linear' }),
      resolved(3),
      resolved(4, { server: 'linear', result: EMcpSignInResult.Failed, reason: 'denied' }),
    ])

    expect(entries.get('e1')?.result).toBe(EMcpSignInResult.Connected)
    expect(entries.get('e2')?.result).toBe(EMcpSignInResult.Failed)
  })

  it('ignores every other event', () => {
    expect(mcpSignInEntries([stamp({ type: 'assistant-said', text: 'hi' }, 1)]).size).toBe(0)
  })
})
