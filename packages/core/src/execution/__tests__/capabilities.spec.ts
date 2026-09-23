import { describe, expect, it } from 'bun:test'

import { capabilitiesNote, EPortExposure, type EnvironmentCapabilities } from '../capabilities'

const capabilities = (partial: Partial<EnvironmentCapabilities>): EnvironmentCapabilities => ({
  canPush: true,
  gitIdentity: null,
  gpgSigning: false,
  dockerAvailable: false,
  persistentFs: true,
  serviceTtlSeconds: null,
  portExposure: EPortExposure.PublicDomain,
  failures: [],
  ...partial,
})

describe('capabilitiesNote', () => {
  it('names the idle window when the environment times its services', () => {
    const note = capabilitiesNote(capabilities({ serviceTtlSeconds: 1_800 }))

    expect(note).toContain('services stop with the sandbox, about 30 minutes after the last activity')
  })

  it('says only that services stop with the sandbox when no timer exists', () => {
    const note = capabilitiesNote(capabilities({ serviceTtlSeconds: null }))

    expect(note).toContain('- services stop with the sandbox')
    expect(note).not.toContain('minutes')
  })
})
