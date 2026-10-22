import { describe, expect, it } from 'bun:test'

import { ESecretKind, EMcpTransportKind } from '@dltech/atlas-wire/web'

import { EWorkspaceRole, NO_DEFAULT_MODEL } from '../../../fixtures/settings-workspace'
import { joinCommandLine, parseKeyValueLines, splitCommandLine } from '../../command-line'
import { planGeneralSave, sanitizeSlug, validateGeneralDraft } from '../general-mapping'
import { pendingInviteOf, workspaceMemberOf } from '../members-mapping'
import { rowOfServer, upsertOfDraft, upsertOfToggle } from '../mcp-mapping'
import { daysUntil, formatDate, relativeTimeOf } from '../relative-time'
import { librarySecretOf } from '../secrets-mapping'
import { canManageWorkspace, parseMemberRole } from '../workspace-role'

const NOW = Date.parse('2026-10-20T12:00:00Z')

describe('command line', () => {
  it('splits quoted arguments and round-trips', () => {
    const parsed = splitCommandLine('npx -y "@scope/pkg name" --flag')
    expect(parsed).toEqual({ command: 'npx', args: ['-y', '@scope/pkg name', '--flag'] })
    expect(joinCommandLine(parsed)).toBe('npx -y "@scope/pkg name" --flag')
  })

  it('parses key/value lines and skips comments', () => {
    expect(parseKeyValueLines({ text: 'A=1\n# c\nB = two\nbad', separator: '=' })).toEqual({
      A: '1',
      B: 'two',
    })
    expect(parseKeyValueLines({ text: 'Authorization: Bearer x', separator: ':' })).toEqual({
      Authorization: 'Bearer x',
    })
  })
})

describe('mcp mapping', () => {
  it('maps stdio and http servers to rows', () => {
    const stdio = rowOfServer({
      name: 'fs',
      transport: { kind: EMcpTransportKind.Stdio, command: 'npx', args: ['-y', 'x'] },
      updatedAt: '',
    })
    expect(stdio).toEqual({ id: 'fs', kind: EMcpTransportKind.Stdio, target: 'npx -y x', enabled: true })
    const http = rowOfServer({
      name: 'l',
      transport: { kind: EMcpTransportKind.Http, url: 'https://a/mcp' },
      disabled: true,
      updatedAt: '',
    })
    expect(http.target).toBe('https://a/mcp')
    expect(http.enabled).toBe(false)
  })

  it('builds upserts from drafts and toggles', () => {
    expect(upsertOfDraft({ kind: EMcpTransportKind.Stdio, target: 'bun run x', extra: 'K=v' })).toEqual({
      transport: { kind: EMcpTransportKind.Stdio, command: 'bun', args: ['run', 'x'], env: { K: 'v' } },
    })
    expect(upsertOfDraft({ kind: EMcpTransportKind.Http, target: ' https://a ' })).toEqual({
      transport: { kind: EMcpTransportKind.Http, url: 'https://a' },
    })
    const server = {
      name: 'a',
      transport: { kind: EMcpTransportKind.Http as const, url: 'https://a' },
      updatedAt: '',
    }
    expect(upsertOfToggle({ server, enabled: false })).toEqual({
      transport: server.transport,
      disabled: true,
    })
  })
})

describe('workspace roles', () => {
  it('picks the highest role from a comma list', () => {
    expect(parseMemberRole('member,admin')).toBe(EWorkspaceRole.Admin)
    expect(parseMemberRole('owner')).toBe(EWorkspaceRole.Owner)
    expect(parseMemberRole('custom')).toBeNull()
  })

  it('lets only owners and admins manage', () => {
    expect(canManageWorkspace(EWorkspaceRole.Admin)).toBe(true)
    expect(canManageWorkspace(EWorkspaceRole.Member)).toBe(false)
    expect(canManageWorkspace(null)).toBe(false)
  })
})

describe('relative time', () => {
  it('formats ages', () => {
    expect(relativeTimeOf({ iso: '2026-10-20T11:59:50Z', now: NOW })).toBe('just now')
    expect(relativeTimeOf({ iso: '2026-10-20T11:30:00Z', now: NOW })).toBe('30m ago')
    expect(relativeTimeOf({ iso: '2026-10-17T12:00:00Z', now: NOW })).toBe('3d ago')
    expect(relativeTimeOf({ iso: 'nope', now: NOW })).toBe('—')
  })

  it('formats dates and day counts', () => {
    expect(formatDate('2026-10-20T22:45:18Z')).toBe('Oct 20, 2026')
    expect(daysUntil({ iso: '2026-10-22T12:00:00Z', now: NOW })).toBe(2)
    expect(daysUntil({ iso: '2026-10-01T12:00:00Z', now: NOW })).toBe(0)
  })
})

describe('members mapping', () => {
  const member = {
    id: 'm1',
    userId: 'u1',
    role: 'owner',
    createdAt: '2026-10-20T22:45:18Z',
    user: { name: 'Dev User', email: 'dev@atlas.local' },
  }

  it('maps members', () => {
    expect(workspaceMemberOf(member)).toEqual({
      id: 'm1',
      userId: 'u1',
      name: 'Dev User',
      email: 'dev@atlas.local',
      initials: 'DU',
      role: EWorkspaceRole.Owner,
      joined: 'Oct 20, 2026',
      lastActive: '—',
    })
  })

  it('maps invitations with the inviter name', () => {
    const invite = pendingInviteOf({
      invitation: {
        id: 'i1',
        email: 'a@b.co',
        role: 'admin',
        status: 'pending',
        expiresAt: '2026-10-22T12:00:00Z',
        inviterId: 'u1',
      },
      members: [member],
      now: NOW,
    })
    expect(invite).toEqual({
      id: 'i1',
      email: 'a@b.co',
      role: EWorkspaceRole.Admin,
      invitedBy: 'Dev User',
      expiresInDays: 2,
    })
  })
})

describe('general mapping', () => {
  const saved = { name: 'DL Tech', slug: 'dltech', region: 'iad1', model: NO_DEFAULT_MODEL }

  it('plans only the changed fields', () => {
    expect(planGeneralSave({ saved, draft: saved })).toEqual({ organization: null, settings: {} })
    expect(
      planGeneralSave({
        saved,
        draft: { ...saved, name: ' New ', region: 'fra1', model: 'gpt-5' },
      }),
    ).toEqual({
      organization: { name: 'New' },
      settings: { 'workspace.defaultRegion': 'fra1', 'workspace.defaultModel': 'gpt-5' },
    })
    expect(planGeneralSave({ saved: { ...saved, model: 'gpt-5' }, draft: saved }).settings).toEqual({
      'workspace.defaultModel': null,
    })
  })

  it('sanitizes slugs and validates drafts', () => {
    expect(sanitizeSlug('My Org_1!')).toBe('myorg1')
    expect(validateGeneralDraft({ ...saved, name: ' ' })).toBe('Workspace name is required')
    expect(validateGeneralDraft(saved)).toBeNull()
  })
})

describe('secret mapping', () => {
  it('maps a workspace secret with the updater', () => {
    const row = librarySecretOf({
      secret: {
        name: 'A',
        kind: ESecretKind.EnvVar,
        value: 'v',
        createdAt: '',
        updatedAt: '2026-10-20T11:00:00Z',
        updatedBy: { userId: 'u', name: 'Dev User' },
      },
      now: NOW,
    })
    expect(row.addedBy).toEqual({ name: 'Dev User', initials: 'DU' })
    expect(row.updated).toBe('1h ago')
    expect(row.kind).toBe('env')
  })
})
