import { describe, expect, it } from 'bun:test'
import * as webWire from '@dltech/atlas-wire/web'

import { CLOUD_CAPABILITIES } from '../cloud-capabilities'

describe('cloud capabilities', () => {
  it('follows what the wire contract exports', () => {
    expect(CLOUD_CAPABILITIES.userVercelCredential).toBe('userVercelCredentialSchema' in webWire)
  })
})
