import { describe, expect, it } from 'bun:test'

import {
  canSaveVercelDraft,
  isVercelDraftDirty,
  requestBodyOf,
  statusLineOf,
  TEAM_ID_REQUIRED,
  TOKEN_REQUIRED,
  validateVercelDraft,
  vercelCredentialSchema,
  viewOfCredential,
  type VercelCredentialView,
} from '../vercel-credential'

const NOW = Date.parse('2026-10-21T12:00:00.000Z')

const configured: VercelCredentialView = {
  configured: true,
  teamId: 'team_abc',
  updatedAt: '2026-10-21T09:00:00.000Z',
}
const unconfigured: VercelCredentialView = { configured: false, teamId: '', updatedAt: null }

describe('requestBodyOf', () => {
  it('trims the team ID and keeps a typed token', () => {
    expect(requestBodyOf({ teamId: '  team_abc ', token: ' tok_123 ' })).toEqual({
      teamId: 'team_abc',
      token: 'tok_123',
    })
  })

  it('omits the token when it is empty or whitespace', () => {
    expect(requestBodyOf({ teamId: 'team_abc', token: '' })).toEqual({ teamId: 'team_abc' })
    expect(requestBodyOf({ teamId: 'team_abc', token: '   ' })).toEqual({ teamId: 'team_abc' })
    expect('token' in requestBodyOf({ teamId: 'team_abc', token: '' })).toBe(false)
  })
})

describe('viewOfCredential', () => {
  it('maps a configured response', () => {
    const wire = vercelCredentialSchema.parse({
      configured: true,
      teamId: 'team_abc',
      updatedAt: '2026-10-21T09:00:00.000Z',
    })
    expect(viewOfCredential(wire)).toEqual(configured)
  })

  it('maps an unconfigured response with null fields', () => {
    const wire = vercelCredentialSchema.parse({ configured: false, teamId: null, updatedAt: null })
    expect(viewOfCredential(wire)).toEqual(unconfigured)
  })

  it('rejects a response that does not match the contract', () => {
    expect(vercelCredentialSchema.safeParse({ configured: 'yes' }).success).toBe(false)
  })
})

describe('statusLineOf', () => {
  it('says not configured', () => {
    expect(statusLineOf({ view: unconfigured, now: NOW })).toBe('Not configured')
  })

  it('says configured with a relative update time', () => {
    expect(statusLineOf({ view: configured, now: NOW })).toBe('Configured · updated 3h ago')
  })

  it('drops the time when the server sent none', () => {
    expect(statusLineOf({ view: { ...configured, updatedAt: null }, now: NOW })).toBe('Configured')
  })
})

describe('isVercelDraftDirty', () => {
  it('is clean when nothing changed', () => {
    expect(isVercelDraftDirty({ view: configured, draft: { teamId: 'team_abc', token: '' } })).toBe(
      false,
    )
  })

  it('ignores whitespace around an unchanged team ID', () => {
    expect(
      isVercelDraftDirty({ view: configured, draft: { teamId: ' team_abc ', token: '' } }),
    ).toBe(false)
  })

  it('is dirty when the team ID or token changed', () => {
    expect(isVercelDraftDirty({ view: configured, draft: { teamId: 'team_new', token: '' } })).toBe(
      true,
    )
    expect(
      isVercelDraftDirty({ view: configured, draft: { teamId: 'team_abc', token: 'tok' } }),
    ).toBe(true)
  })
})

describe('validateVercelDraft', () => {
  it('requires a team ID', () => {
    expect(validateVercelDraft({ view: configured, draft: { teamId: '  ', token: '' } })).toBe(
      TEAM_ID_REQUIRED,
    )
  })

  it('requires a token until one is stored', () => {
    expect(
      validateVercelDraft({ view: unconfigured, draft: { teamId: 'team_abc', token: '' } }),
    ).toBe(TOKEN_REQUIRED)
  })

  it('lets a configured credential change team without a token', () => {
    expect(
      validateVercelDraft({ view: configured, draft: { teamId: 'team_new', token: '' } }),
    ).toBeNull()
  })
})

describe('canSaveVercelDraft', () => {
  it('needs both the team ID and the token while nothing is stored', () => {
    expect(canSaveVercelDraft({ view: unconfigured, draft: { teamId: '', token: '' } })).toBe(false)
    expect(
      canSaveVercelDraft({ view: unconfigured, draft: { teamId: 'team_abc', token: '' } }),
    ).toBe(false)
    expect(canSaveVercelDraft({ view: unconfigured, draft: { teamId: '', token: 'tok' } })).toBe(
      false,
    )
    expect(
      canSaveVercelDraft({ view: unconfigured, draft: { teamId: 'team_abc', token: '  ' } }),
    ).toBe(false)
    expect(
      canSaveVercelDraft({ view: unconfigured, draft: { teamId: 'team_abc', token: 'tok' } }),
    ).toBe(true)
  })

  it('keeps the token optional once configured', () => {
    expect(canSaveVercelDraft({ view: configured, draft: { teamId: 'team_abc', token: '' } })).toBe(
      false,
    )
    expect(canSaveVercelDraft({ view: configured, draft: { teamId: 'team_new', token: '' } })).toBe(
      true,
    )
    expect(
      canSaveVercelDraft({ view: configured, draft: { teamId: 'team_abc', token: 'tok' } }),
    ).toBe(true)
    expect(canSaveVercelDraft({ view: configured, draft: { teamId: '', token: 'tok' } })).toBe(
      false,
    )
  })

  it('sends no token key when a configured credential only changes team', () => {
    expect(requestBodyOf({ teamId: 'team_new', token: '' })).toEqual({ teamId: 'team_new' })
  })
})
