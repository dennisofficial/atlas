import { describe, expect, it } from 'bun:test'
import * as host from '@dltech/atlas-agent-host/host/tokens'

import { MCP_OAUTH_BEGIN, OPERATOR_ANSWERS, SESSION_STREAM } from '../host-call-tokens'

describe('host call tokens', () => {
  it('resolve to the agent host providers', () => {
    expect(SESSION_STREAM).toBe(host.SESSION_STREAM)
    expect(OPERATOR_ANSWERS).toBe(host.OPERATOR_ANSWERS)
    expect(MCP_OAUTH_BEGIN).toBe(host.MCP_OAUTH_BEGIN)
  })
})
