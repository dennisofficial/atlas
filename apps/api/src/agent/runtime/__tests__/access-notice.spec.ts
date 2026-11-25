import { describe, expect, it } from 'bun:test'

import type { AccessRows } from '../../config/access-rows'
import { accessNoticeOf } from '../access-notice'

const rowsOf = (overrides: Partial<AccessRows> = {}): AccessRows => ({
  userGrants: [],
  projectGrants: [],
  userSecrets: [],
  projectSecrets: [],
  userFiles: [],
  projectFiles: [],
  ...overrides,
})

const EMPTY_NOTICE =
  'Atlas Cloud gives you no secrets or access grants in this session. The operator adds them in the Access settings of Atlas Cloud.'

const INTRO = 'Atlas Cloud gives you this access. The operator wrote each description.'

const SECRET_USE =
  'Use a secret by name, for example "$NAME" in a command. Do not ask the operator for the values. Never print, log or commit them.'

const SETTINGS =
  'The operator changes this access in the Access settings of Atlas Cloud. A secret change reaches new shells without a restart. A file change reaches the sandbox at its next start.'

describe('accessNoticeOf', () => {
  it('groups project secrets and project files under their grant', () => {
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
        SECRET_USE,
        SETTINGS,
      ].join('\n\n'),
    )
  })

  it('lists personal files under their personal grant', () => {
    const notice = accessNoticeOf(
      rowsOf({
        userGrants: [{ id: 'grant-notes', name: 'Notes', instruction: 'Read them once.' }],
        userFiles: [{ path: '~/notes.md', grantId: 'grant-notes' }],
      }),
    )

    expect(notice).toContain(['Notes', 'Files: ~/notes.md', 'Read them once.'].join('\n'))
    expect(notice).not.toContain(SECRET_USE)
  })

  it('hides a personal file behind a project file of the same path, because the project file wins', () => {
    const notice = accessNoticeOf(
      rowsOf({
        userGrants: [{ id: 'grant-personal', name: 'Personal', instruction: '' }],
        projectGrants: [{ id: 'grant-project', name: 'Project', instruction: '' }],
        userFiles: [
          { path: '~/notes.md', grantId: 'grant-personal' },
          { path: '~/.npmrc', grantId: 'grant-personal' },
        ],
        projectFiles: [{ path: '~/notes.md', grantId: 'grant-project' }],
      }),
    )

    expect(notice).toContain(['Project', 'Files: ~/notes.md'].join('\n'))
    expect(notice).toContain(['Personal', 'Files: ~/.npmrc'].join('\n'))
    expect(notice.match(/~/g)).toHaveLength(2)
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
        userGrants: [{ id: 'grant-mixed', name: 'Mixed', instruction: '' }],
        userSecrets: [
          { name: 'ATLAS_HOME', grantId: 'grant-mixed' },
          { name: 'search.brave', grantId: 'grant-mixed' },
          { name: '2LEADING_DIGIT', grantId: 'grant-mixed' },
          { name: 'GOOD_NAME', grantId: 'grant-mixed' },
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

  it('sorts the members of a grant by name and path, and trims its instruction', () => {
    const notice = accessNoticeOf(
      rowsOf({
        projectGrants: [{ id: 'grant-files', name: 'Files', instruction: '  Read them.  ' }],
        projectSecrets: [
          { name: 'Z_TOKEN', grantId: 'grant-files' },
          { name: 'A_TOKEN', grantId: 'grant-files' },
        ],
        projectFiles: [
          { path: 'z/.env', grantId: 'grant-files' },
          { path: 'a/.env', grantId: 'grant-files' },
        ],
      }),
    )

    expect(notice).toContain(
      [
        'Files',
        'Environment variables: A_TOKEN, Z_TOKEN',
        'Files: a/.env, z/.env',
        'Read them.',
      ].join('\n'),
    )
  })

  it('leaves out a member whose grant is not in the rows', () => {
    const notice = accessNoticeOf(
      rowsOf({ projectFiles: [{ path: 'apps/api/.env.keys', grantId: 'grant-gone' }] }),
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
    const files = [
      { path: '~/b.md', grantId: 'grant-1' },
      { path: '~/a.md', grantId: 'grant-1' },
    ]

    expect(
      accessNoticeOf(
        rowsOf({ projectGrants: [grant], projectSecrets: secrets, projectFiles: files }),
      ),
    ).toBe(
      accessNoticeOf(
        rowsOf({
          projectGrants: [grant],
          projectSecrets: [...secrets].reverse(),
          projectFiles: [...files].reverse(),
        }),
      ),
    )
  })
})
