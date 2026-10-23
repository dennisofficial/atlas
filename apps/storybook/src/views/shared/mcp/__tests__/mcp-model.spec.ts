import { describe, expect, test } from 'bun:test'

import {
  EMcpAuth,
  EMcpOAuthState,
  EMcpScope,
  EMcpTransport,
  type McpServer,
} from '../../../../fixtures/settings-mcp'
import {
  overriddenNames,
  removeServer,
  setConnection,
  setEnabled,
  splitByScope,
  upsertDrafts,
} from '../mcp-model'

function server({ name, scope }: { name: string; scope: EMcpScope }): McpServer {
  return {
    name,
    scope,
    enabled: true,
    spec: {
      transport: EMcpTransport.Http,
      url: `https://${name}.dev/mcp`,
      auth: { kind: EMcpAuth.OAuth, clientId: '', clientSecret: '' },
      headers: [],
    },
    connection: { state: EMcpOAuthState.Connected, account: 'a@b.dev' },
  }
}

const rows = [
  server({ name: 'linear', scope: EMcpScope.Project }),
  server({ name: 'linear', scope: EMcpScope.Personal }),
  server({ name: 'posthog', scope: EMcpScope.Personal }),
]

describe('splitByScope', () => {
  test('separates project and personal rows in order', () => {
    const { project, personal } = splitByScope(rows)
    expect(project.map((row) => row.name)).toEqual(['linear'])
    expect(personal.map((row) => row.name)).toEqual(['linear', 'posthog'])
  })

  test('returns empty groups for no rows', () => {
    expect(splitByScope([])).toEqual({ project: [], personal: [] })
  })
})

describe('overriddenNames', () => {
  test('lists personal names shadowed by a project server', () => {
    expect([...overriddenNames(rows)]).toEqual(['linear'])
  })

  test('is empty without project servers', () => {
    expect(overriddenNames(rows.filter((row) => row.scope === EMcpScope.Personal)).size).toBe(0)
  })
})

describe('editing a personal row from the project page', () => {
  const personalPosthog = rows[2]
  if (!personalPosthog) throw new Error('fixture missing')

  test('toggle only touches the personal row', () => {
    const next = setEnabled({ rows, target: personalPosthog, enabled: false })
    expect(next.map((row) => row.enabled)).toEqual([true, true, false])
  })

  test('toggle on a shadowed personal row leaves the project row alone', () => {
    const shadowed = rows[1]
    if (!shadowed) throw new Error('fixture missing')
    const next = setEnabled({ rows, target: shadowed, enabled: false })
    expect(next.map((row) => row.enabled)).toEqual([true, false, true])
  })

  test('sign out only touches the personal row', () => {
    const next = setConnection({
      rows,
      target: personalPosthog,
      connection: { state: EMcpOAuthState.SignInRequired },
    })
    expect(next[2]?.connection?.state).toBe(EMcpOAuthState.SignInRequired)
    expect(next[0]?.connection?.state).toBe(EMcpOAuthState.Connected)
  })

  test('remove drops only the targeted personal row', () => {
    const shadowed = rows[1]
    if (!shadowed) throw new Error('fixture missing')
    const next = removeServer({ rows, target: shadowed })
    expect(next.map((row) => `${row.scope}:${row.name}`)).toEqual([
      'project:linear',
      'personal:posthog',
    ])
  })

  test('upsert in personal scope keeps the project row and the sign-in state for an unchanged url', () => {
    const next = upsertDrafts({
      rows,
      drafts: [{ name: 'posthog', enabled: true, spec: personalPosthog.spec }],
      scope: EMcpScope.Personal,
    })
    expect(next).toHaveLength(3)
    expect(next[2]?.connection?.state).toBe(EMcpOAuthState.Connected)
    expect(next[0]?.scope).toBe(EMcpScope.Project)
  })

  test('upsert does not reorder rows', () => {
    const next = upsertDrafts({
      rows,
      drafts: [{ name: 'new', enabled: true, spec: personalPosthog.spec }],
      scope: EMcpScope.Project,
    })
    expect(next.map((row) => row.name)).toEqual(['linear', 'linear', 'posthog', 'new'])
    expect(next[3]?.connection?.state).toBe(EMcpOAuthState.SignInRequired)
  })
})
