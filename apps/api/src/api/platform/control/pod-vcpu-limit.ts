import { BadRequestException } from '@nestjs/common'
import { ESandboxProvider } from '@dltech/atlas-protocol'

/**
 * The vCPU counts an Agent37 sandbox can run at — every other count is rounded up to the next vm
 * shape, so a resize to anything else would not apply the size it was asked for.
 * Duplicated from `src/agent/sandbox/agent37/agent37-resize.ts` to keep this layer off the sandbox port.
 */
export const AGENT37_VCPU_SIZES: readonly number[] = [2, 4, 8]

/** Vercel on Atlas credentials and Agent37 both stop at 8 vCPU. */
export const PLATFORM_VCPU_CAP = 8

export type VcpuLimit = { cap: number; sizes?: readonly number[] }

export const vcpuLimitOf = (args: { sandboxProvider: string }): VcpuLimit =>
  args.sandboxProvider === ESandboxProvider.Agent37
    ? { cap: PLATFORM_VCPU_CAP, sizes: AGENT37_VCPU_SIZES }
    : { cap: PLATFORM_VCPU_CAP }

export const assertWithinVcpuLimit = (args: { vcpus: number; limit: VcpuLimit }): void => {
  const { limit } = args
  if (limit.sizes !== undefined && !limit.sizes.includes(args.vcpus)) {
    throw new BadRequestException(
      `${args.vcpus} vCPU is not a size this sandbox runs at; pick one of ${limit.sizes.join(', ')}`,
    )
  }
  if (args.vcpus <= limit.cap) return
  throw new BadRequestException(
    `${args.vcpus} vCPU exceeds the ${limit.cap} vCPU cap for this sandbox provider`,
  )
}
