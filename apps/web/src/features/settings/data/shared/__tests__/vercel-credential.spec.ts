import { describe, expect, it } from 'bun:test'

import {
  canSaveVercelDraft,
  isVercelDraftDirty,
  PROJECT_ID_REQUIRED,
  requestBodyOf,
  statusLineOf,
  TEAM_ID_REQUIRED,
  TOKEN_REQUIRED,
  validateVercelDraft,
  vercelCredentialSchema,
  viewOfCredential,
  type VercelCredentialView,
  type VercelDraft,
} from '../vercel-credential'

const NOW = Date.parse('2026-10-21T12:00:00.000Z')

const configured: VercelCredentialView = {
  configured: true,
  teamId: 'team_abc',
  vercelProjectId: 'prj_abc',
  updatedAt: '2026-10-21T09:00:00.000Z',
}
const unconfigured: VercelCredentialView = {
  configured: false,
  teamId: '',
  vercelProjectId: '',
  updatedAt: null,
}
const withoutProject: VercelCredentialView = { ...configured, vercelProjectId: '' }

const draftOf = (patch: Partial<VercelDraft> = {}): VercelDraft => ({
  teamId: 'team_abc',
  vercelProjectId: 'prj_abc',
  token: '',
  ...patch,
})

describe('requestBodyOf', () => {
  it('trims the team and project IDs and keeps a typed token', () => {
    expect(
      requestBodyOf({ teamId: '  team_abc ', vercelProjectId: ' prj_abc  ', token: ' tok_123 ' }),
    ).toEqual({ teamId: 'team_abc', vercelProjectId: 'prj_abc', token: 'tok_123' })
  })

  it('omits the token when it is empty or whitespace', () => {
    const expected = { teamId: 'team_abc', vercelProjectId: 'prj_abc' }
    expect(requestBodyOf(draftOf({ token: '' }))).toEqual(expected)
    expect(requestBodyOf(draftOf({ token: '   ' }))).toEqual(expected)
    expect('token' in requestBodyOf(draftOf())).toBe(false)
  })

  it('always sends the project ID, even when only the token changed', () => {
    expect(requestBodyOf(draftOf({ token: 'tok' })).vercelProjectId).toBe('prj_abc')
  })
})

describe('viewOfCredential', () => {
  it('maps a configured response', () => {
    const wire = vercelCredentialSchema.parse({
      configured: true,
      teamId: 'team_abc',
      vercelProjectId: 'prj_abc',
      updatedAt: '2026-10-21T09:00:00.000Z',
    })
    expect(viewOfCredential(wire)).toEqual(configured)
  })

  it('maps an unconfigured response with null fields', () => {
    const wire = vercelCredentialSchema.parse({
      configured: false,
      teamId: null,
      vercelProjectId: null,
      updatedAt: null,
    })
    expect(viewOfCredential(wire)).toEqual(unconfigured)
  })

  it('maps a configured credential that predates the project ID', () => {
    const wire = vercelCredentialSchema.parse({
      configured: true,
      teamId: 'team_abc',
      vercelProjectId: null,
      updatedAt: '2026-10-21T09:00:00.000Z',
    })
    expect(viewOfCredential(wire)).toEqual(withoutProject)
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

  it('flags a configured credential that has no project ID yet', () => {
    expect(statusLineOf({ view: withoutProject, now: NOW })).toBe('Needs a Vercel project ID')
  })
})

describe('isVercelDraftDirty', () => {
  it('is clean when nothing changed', () => {
    expect(isVercelDraftDirty({ view: configured, draft: draftOf() })).toBe(false)
  })

  it('ignores whitespace around unchanged IDs', () => {
    expect(
      isVercelDraftDirty({
        view: configured,
        draft: draftOf({ teamId: ' team_abc ', vercelProjectId: ' prj_abc ' }),
      }),
    ).toBe(false)
  })

  it('is dirty when the team ID, project ID or token changed', () => {
    expect(isVercelDraftDirty({ view: configured, draft: draftOf({ teamId: 'team_new' }) })).toBe(
      true,
    )
    expect(
      isVercelDraftDirty({ view: configured, draft: draftOf({ vercelProjectId: 'prj_new' }) }),
    ).toBe(true)
    expect(isVercelDraftDirty({ view: configured, draft: draftOf({ token: 'tok' }) })).toBe(true)
  })
})

describe('validateVercelDraft', () => {
  it('requires a team ID', () => {
    expect(validateVercelDraft({ view: configured, draft: draftOf({ teamId: '  ' }) })).toBe(
      TEAM_ID_REQUIRED,
    )
  })

  it('requires a project ID on every save', () => {
    expect(
      validateVercelDraft({ view: configured, draft: draftOf({ vercelProjectId: ' ' }) }),
    ).toBe(PROJECT_ID_REQUIRED)
  })

  it('requires a token until one is stored', () => {
    expect(validateVercelDraft({ view: unconfigured, draft: draftOf() })).toBe(TOKEN_REQUIRED)
  })

  it('lets a configured credential change team without a token', () => {
    expect(
      validateVercelDraft({ view: configured, draft: draftOf({ teamId: 'team_new' }) }),
    ).toBeNull()
  })
})

describe('canSaveVercelDraft', () => {
  it('needs team ID, project ID and token while nothing is stored', () => {
    const needs = (patch: Partial<VercelDraft>) =>
      canSaveVercelDraft({ view: unconfigured, draft: draftOf({ token: 'tok', ...patch }) })
    expect(needs({})).toBe(true)
    expect(needs({ teamId: '' })).toBe(false)
    expect(needs({ vercelProjectId: '' })).toBe(false)
    expect(needs({ token: '  ' })).toBe(false)
  })

  it('keeps the token optional once configured', () => {
    expect(canSaveVercelDraft({ view: configured, draft: draftOf() })).toBe(false)
    expect(canSaveVercelDraft({ view: configured, draft: draftOf({ teamId: 'team_new' }) })).toBe(
      true,
    )
    expect(
      canSaveVercelDraft({ view: configured, draft: draftOf({ vercelProjectId: 'prj_new' }) }),
    ).toBe(true)
    expect(canSaveVercelDraft({ view: configured, draft: draftOf({ token: 'tok' }) })).toBe(true)
    expect(
      canSaveVercelDraft({ view: configured, draft: draftOf({ teamId: '', token: 'tok' }) }),
    ).toBe(false)
  })

  it('lets a credential without a project ID be completed with just the project ID', () => {
    expect(
      canSaveVercelDraft({ view: withoutProject, draft: draftOf({ vercelProjectId: '' }) }),
    ).toBe(false)
    expect(canSaveVercelDraft({ view: withoutProject, draft: draftOf() })).toBe(true)
  })
})
