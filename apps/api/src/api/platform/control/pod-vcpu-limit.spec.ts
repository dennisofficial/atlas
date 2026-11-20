import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@nestjs/common'
import { ECredentialSource, ESandboxProvider } from '@dltech/atlas-protocol'

import {
  AGENT37_VCPU_SIZES,
  assertWithinVcpuLimit,
  PLATFORM_VCPU_CAP,
  vcpuLimitOf,
} from './pod-vcpu-limit'

describe('vcpuLimitOf', () => {
  it('defers a BYOK Vercel session to the connected team plan', () => {
    expect(
      vcpuLimitOf({
        sandboxProvider: ESandboxProvider.Vercel,
        credentialSource: ECredentialSource.Byok,
      }),
    ).toBeNull()
  })

  it('caps a Vercel session on Atlas credentials at 8 wherever the payers plan would allow more', () => {
    expect(
      vcpuLimitOf({
        sandboxProvider: ESandboxProvider.Vercel,
        credentialSource: ECredentialSource.Platform,
      }),
    ).toEqual({ cap: PLATFORM_VCPU_CAP })
  })

  it('caps an Agent37 session at 8 and only at the Agent37 cpu counts', () => {
    expect(
      vcpuLimitOf({
        sandboxProvider: ESandboxProvider.Agent37,
        credentialSource: ECredentialSource.Platform,
      }),
    ).toEqual({ cap: PLATFORM_VCPU_CAP, sizes: AGENT37_VCPU_SIZES })
  })
})

describe('assertWithinVcpuLimit', () => {
  const vercelPlatform = vcpuLimitOf({
    sandboxProvider: ESandboxProvider.Vercel,
    credentialSource: ECredentialSource.Platform,
  })

  it('accepts 8 on a platform-credential Vercel pod', () => {
    expect(() => assertWithinVcpuLimit({ vcpus: 8, limit: vercelPlatform })).not.toThrow()
  })

  it('refuses 16 on a platform-credential Vercel pod', () => {
    expect(() => assertWithinVcpuLimit({ vcpus: 16, limit: vercelPlatform })).toThrow(
      BadRequestException,
    )
  })

  it('refuses 3 on an Agent37 pod whatever the Vercel plan says', () => {
    const agent37 = vcpuLimitOf({
      sandboxProvider: ESandboxProvider.Agent37,
      credentialSource: ECredentialSource.Platform,
    })
    expect(() => assertWithinVcpuLimit({ vcpus: 3, limit: agent37 })).toThrow(BadRequestException)
  })

  it('accepts 8 on an Agent37 pod whatever the Vercel plan says', () => {
    const agent37 = vcpuLimitOf({
      sandboxProvider: ESandboxProvider.Agent37,
      credentialSource: ECredentialSource.Platform,
    })
    expect(() => assertWithinVcpuLimit({ vcpus: 8, limit: agent37 })).not.toThrow()
  })

  it('refuses 6 on an Agent37 pod because no vm shape runs at 6 vCPU', () => {
    const agent37 = vcpuLimitOf({
      sandboxProvider: ESandboxProvider.Agent37,
      credentialSource: ECredentialSource.Platform,
    })
    expect(() => assertWithinVcpuLimit({ vcpus: 6, limit: agent37 })).toThrow('pick one of 2, 4, 8')
  })

  it('passes a deferred limit straight through', () => {
    expect(() => assertWithinVcpuLimit({ vcpus: 32, limit: null })).not.toThrow()
  })
})
