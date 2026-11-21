import { BadRequestException } from '@nestjs/common'
import {
  podShapeAllowed,
  podShapeLabel,
  podShapeOfferedAt,
  podSizingOf,
  type PodShape,
  type PodSizing,
} from '@dltech/atlas-core'

export const podSizingLimitOf = (args: { sandboxProvider: string }): PodSizing =>
  podSizingOf({ sandboxProvider: args.sandboxProvider })

const reasonOf = (args: { shape: PodShape; sizing: PodSizing }): string => {
  const { shape, sizing } = args
  if (shape.vcpus > sizing.cap) {
    return `${shape.vcpus} vCPU exceeds the ${sizing.cap} vCPU cap for this sandbox provider`
  }
  const atVcpus = podShapeOfferedAt({ vcpus: shape.vcpus, sizing })
  if (atVcpus.length === 0) {
    return `${shape.vcpus} vCPU is not a size this sandbox runs at; pick one of ${sizing.offered
      .map(podShapeLabel)
      .join(', ')}`
  }
  return `${podShapeLabel(shape)} is not a shape this sandbox runs at; ${shape.vcpus} vCPU runs at ${atVcpus
    .map((offered) => `${offered.memoryGb} GB`)
    .join(' or ')}`
}

export const assertWithinShapeLimit = (args: { shape: PodShape; sizing: PodSizing }): void => {
  if (podShapeAllowed(args)) return
  throw new BadRequestException(reasonOf(args))
}
