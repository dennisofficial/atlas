import { expect, it } from 'bun:test'

import { EClientRequest } from '../channel-wire'
import { requestTimeoutFor, WORKSPACE_REQUEST_TIMEOUT_MS } from '../request-timeout'

it('allows the workspace transfer budget for a full source cleanup recheck', () => {
  expect(requestTimeoutFor({ op: EClientRequest.ConfirmWorkspaceCleanup })).toBe(WORKSPACE_REQUEST_TIMEOUT_MS)
  expect(requestTimeoutFor({ op: EClientRequest.ConfirmWorkspaceCleanup, overrideMs: 1234 })).toBe(1234)
})
