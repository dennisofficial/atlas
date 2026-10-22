import { describe, expect, it } from 'bun:test'
import * as webWire from '@dltech/atlas-wire/web'

import { CLOUD_CAPABILITIES } from '../cloud-capabilities'

describe('cloud capabilities', () => {
  it('follows what the wire contract exports', () => {
    expect(CLOUD_CAPABILITIES.workspaceVercelCredential).toBe(
      'workspaceVercelCredentialSchema' in webWire,
    )
    expect(CLOUD_CAPABILITIES.userVercelCredential).toBe('userVercelCredentialSchema' in webWire)
    expect(CLOUD_CAPABILITIES.projectWorkspace).toBe(
      'organizationId' in webWire.projectSchema.shape,
    )
  })
})
