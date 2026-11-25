import { describe, expect, it } from 'bun:test'

import type { AccessRows } from '../../config/access-rows'
import { accessNoticeOf } from '../access-notice'

const rowsOf = (overrides: Partial<AccessRows> = {}): AccessRows => ({
  userGrants: [],
  projectGrants: [],
  userSecrets: [],
  projectSecrets: [],
  projectFiles: [],
  ...overrides,
})

const EMPTY_NOTICE =
  'Atlas Cloud gives you no secrets or access grants in this session. The operator adds them in the Secrets, Files and Access settings of Atlas Cloud.'

const INTRO = 'Atlas Cloud gives you this access. The operator wrote each description.'

const SECRET_USE =
  'Use a secret by name, for example "$NAME" in a command. Do not ask the operator for the values. Never print, log or commit them.'

const SETTINGS =
  'The operator changes this access in the Secrets, Files and Access settings of Atlas Cloud. A secret change reaches new shells without a restart. A file change reaches the sandbox at its next start.'

describe('accessNoticeOf', () => {
  it('groups secrets and files under their grant, lists ungrouped secrets, and states the rules once', () => {
    const notice = accessNoticeOf(
      rowsOf({
        projectGrants: [
          {
            id: 'grant-planetscale',
            name: 'PlanetScale',
            instruction: 'Use it for database work.',
          },
        ],
        projectSecrets: [
          { name: 'PLANETSCALE_SERVICE_TOKEN', grantId: 'grant-planetscale' },
          { name: 'PLANETSCALE_SERVICE_TOKEN_ID', grantId: 'grant-planetscale' },
          { name: 'AGENT37_API_KEY', grantId: null },
        ],
        projectFiles: [{ path: 'apps/api/.env.keys', grantId: 'grant-planetscale' }],
      }),
    )

    expect(notice).toBe(
      [
        INTRO,
        [
          'PlanetScale',
          'Environment variables: PLANETSCALE_SERVICE_TOKEN, PLANETSCALE_SERVICE_TOKEN_ID',
          'Files: apps/api/.env.keys',
          'Use it for database work.',
        ].join('\n'),
        ['Other secrets', 'Environment variables: AGENT37_API_KEY'].join('\n'),
        SECRET_USE,
        SETTINGS,
      ].join('\n\n'),
    )
  })

  it('lets the project secret of a name win and attributes it to the project grant', () => {
    const notice = accessNoticeOf(
      rowsOf({
        userGrants: [{ id: 'grant-personal', name: 'Personal', instruction: '' }],
        projectGrants: [{ id: 'grant-shared', name: 'Shared', instruction: '' }],
        userSecrets: [{ name: 'API_KEY', grantId: 'grant-personal' }],
        projectSecrets: [{ name: 'API_KEY', grantId: 'grant-shared' }],
      }),
    )

    expect(notice).toContain(['Shared', 'Environment variables: API_KEY'].join('\n'))
    expect(notice).toContain('\n\nPersonal\n\n')
    expect(notice).not.toContain('Other secrets')
  })

  it('drops names an env var cannot hold and Atlas-owned names', () => {
    const notice = accessNoticeOf(
      rowsOf({
        userSecrets: [
          { name: 'ATLAS_HOME', grantId: null },
          { name: 'search.brave', grantId: null },
          { name: '2LEADING_DIGIT', grantId: null },
          { name: 'GOOD_NAME', grantId: null },
        ],
      }),
    )

    expect(notice).toContain('Environment variables: GOOD_NAME')
    expect(notice).not.toContain('ATLAS_HOME')
    expect(notice).not.toContain('search.brave')
    expect(notice).not.toContain('2LEADING_DIGIT')
  })

  it('shows a grant that has no members', () => {
    const notice = accessNoticeOf(
      rowsOf({
        projectGrants: [{ id: 'grant-gh', name: 'GitHub CLI', instruction: 'gh is signed in.' }],
      }),
    )

    expect(notice).toContain(['GitHub CLI', 'gh is signed in.'].join('\n'))
    expect(notice).not.toContain('Environment variables:')
    expect(notice).not.toContain(SECRET_USE)
  })

  it('sorts the files of a grant and trims its instruction', () => {
    const notice = accessNoticeOf(
      rowsOf({
        projectGrants: [{ id: 'grant-files', name: 'Files', instruction: '  Read them.  ' }],
        projectFiles: [
          { path: 'z/.env', grantId: 'grant-files' },
          { path: 'a/.env', grantId: 'grant-files' },
        ],
      }),
    )

    expect(notice).toContain(['Files', 'Files: a/.env, z/.env', 'Read them.'].join('\n'))
  })

  it('does not list a file mount that belongs to no grant', () => {
    const notice = accessNoticeOf(
      rowsOf({ projectFiles: [{ path: 'apps/api/.env.keys', grantId: null }] }),
    )

    expect(notice).toBe(EMPTY_NOTICE)
  })

  it('lists project grants before personal grants, each sorted by name', () => {
    const notice = accessNoticeOf(
      rowsOf({
        userGrants: [
          { id: 'user-b', name: 'Personal B', instruction: '' },
          { id: 'user-a', name: 'Personal A', instruction: '' },
        ],
        projectGrants: [
          { id: 'project-b', name: 'Project B', instruction: '' },
          { id: 'project-a', name: 'Project A', instruction: '' },
        ],
      }),
    )

    const order = ['Project A', 'Project B', 'Personal A', 'Personal B'].map((name) =>
      notice.indexOf(name),
    )
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  it('says there is no access rather than staying empty', () => {
    expect(accessNoticeOf(rowsOf())).toBe(EMPTY_NOTICE)
  })

  it('produces the same text for the same rows in any input order', () => {
    const grant = { id: 'grant-1', name: 'One', instruction: '' }
    const secrets = [
      { name: 'B_TOKEN', grantId: 'grant-1' },
      { name: 'A_TOKEN', grantId: 'grant-1' },
    ]

    expect(accessNoticeOf(rowsOf({ projectGrants: [grant], projectSecrets: secrets }))).toBe(
      accessNoticeOf(rowsOf({ projectGrants: [grant], projectSecrets: [...secrets].reverse() })),
    )
  })
})
