import { describe, expect, it } from 'bun:test'

import { EMcpOauthGrantStatus, EMcpServerSource, type McpOauthServer } from '@dltech/atlas-wire/web'

import { signInTargetOf } from '../sign-in-target'

const server: McpOauthServer = {
  id: 'mcps_row_1',
  name: 'linear',
  source: EMcpServerSource.Cloud,
  url: 'https://mcp.linear.app/mcp',
  status: EMcpOauthGrantStatus.None,
}

describe('signInTargetOf', () => {
  it('signs in with the oauth row id, never the server name', () => {
    expect(signInTargetOf(server)).toEqual({ serverId: 'mcps_row_1', label: 'mcp.linear.app' })
  })

  it('offers no sign-in for a server the api has no oauth row for', () => {
    expect(signInTargetOf(undefined)).toBeUndefined()
  })
})
