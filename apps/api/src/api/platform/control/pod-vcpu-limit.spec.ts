import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@nestjs/common'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import {
  AGENT37_VCPU_SIZES,
  assertWithinVcpuLimit,
  PLATFORM_VCPU_CAP,
  vcpuLimitOf,
} from './pod-vcpu-limit'

describe('vcpuLimitOf', () => {
  it('caps a Vercel pod at 8 whatever plan the owner used to connect', () => {
    expect(vcpuLimitOf({ sandboxProvider: ESandboxProvider.Vercel })).toEqual({
      cap: PLATFORM_VCPU_CAP,
    })
  })

  it('caps an Agent37 session at 8 and only at the Agent37 cpu counts', () => {
    expect(vcpuLimitOf({ sandboxProvider: ESandboxProvider.Agent37 })).toEqual({
      cap: PLATFORM_VCPU_CAP,
      sizes: AGENT37_VCPU_SIZES,
    })
  })
})

describe('assertWithinVcpuLimit', () => {
  const vercel = vcpuLimitOf({ sandboxProvider: ESandboxProvider.Vercel })

  it('accepts 8 on a Vercel pod', () => {
    expect(() => assertWithinVcpuLimit({ vcpus: 8, limit: vercel })).not.toThrow()
  })

  it('refuses 16 on a Vercel pod', () => {
    expect(() => assertWithinVcpuLimit({ vcpus: 16, limit: vercel })).toThrow(BadRequestException)
  })

  it('refuses 3 on an Agent37 pod', () => {
    const agent37 = vcpuLimitOf({ sandboxProvider: ESandboxProvider.Agent37 })
    expect(() => assertWithinVcpuLimit({ vcpus: 3, limit: agent37 })).toThrow(
      /not a size this sandbox runs at/,
    )
  })

  it('refuses 16 on an Agent37 pod', () => {
    const agent37 = vcpuLimitOf({ sandboxProvider: ESandboxProvider.Agent37 })
    expect(() => assertWithinVcpuLimit({ vcpus: 16, limit: agent37 })).toThrow(
      /not a size this sandbox runs at/,
    )
  })
})
