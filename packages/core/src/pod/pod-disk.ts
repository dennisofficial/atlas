export const POD_DISK_GROW_AT = 0.7
export const POD_DISK_GROW_FACTOR = 2
export const POD_DISK_URGENT_AT = 0.9
export const POD_DISK_URGENT_FREE_BYTES = 2 * 2 ** 30
export const POD_DISK_URGENT_FREE_SHARE = 0.15

const BYTES_PER_GB = 2 ** 30

export enum EPodDiskPressure {
  Fine = 'fine',
  Grow = 'grow',
  Urgent = 'urgent',
}

export const podDiskPressureOf = (args: {
  usedBytes: number
  limitBytes: number
}): EPodDiskPressure => {
  if (args.limitBytes <= 0) return EPodDiskPressure.Fine
  const usedBytes = Math.max(0, args.usedBytes)
  const freeBytes = args.limitBytes - usedBytes
  if (usedBytes / args.limitBytes >= POD_DISK_URGENT_AT) return EPodDiskPressure.Urgent
  const urgentFreeBytes = Math.max(
    POD_DISK_URGENT_FREE_BYTES,
    POD_DISK_URGENT_FREE_SHARE * args.limitBytes,
  )
  if (freeBytes < urgentFreeBytes) return EPodDiskPressure.Urgent
  if (usedBytes / args.limitBytes >= POD_DISK_GROW_AT) return EPodDiskPressure.Grow
  return EPodDiskPressure.Fine
}

export const podDiskGrowthOf = (args: {
  usedBytes: number
  limitBytes: number
  maxGb: number
  sizeGb?: number | undefined
}): number | undefined => {
  if (args.limitBytes <= 0) return undefined
  if (args.usedBytes / args.limitBytes < POD_DISK_GROW_AT) return undefined
  const limitGb = args.sizeGb ?? Math.round(args.limitBytes / BYTES_PER_GB)
  if (limitGb >= args.maxGb) return undefined
  return Math.min(args.maxGb, Math.ceil(limitGb * POD_DISK_GROW_FACTOR))
}

export const POD_DISK_CEILING_NUDGE_LEVELS = [85, 95] as const

export const POD_DISK_CEILING_REARM_BELOW = 80

export enum EPodDiskCeilingAction {
  None = 'none',
  Nudge = 'nudge',
  Rearm = 'rearm',
}

export type PodDiskCeilingDecision = {
  action: EPodDiskCeilingAction
  percent?: number | undefined
}

export const podDiskCeilingNudgeOf = (args: {
  usedBytes: number
  limitBytes: number
  nudgedPercent: number | undefined
}): PodDiskCeilingDecision => {
  if (args.limitBytes <= 0) return { action: EPodDiskCeilingAction.None }
  const usedPercent = (Math.max(0, args.usedBytes) / args.limitBytes) * 100
  let level: number | undefined
  for (const candidate of POD_DISK_CEILING_NUDGE_LEVELS) {
    if (usedPercent >= candidate) level = candidate
  }
  if (level !== undefined && level > (args.nudgedPercent ?? 0)) {
    return { action: EPodDiskCeilingAction.Nudge, percent: level }
  }
  if (usedPercent < POD_DISK_CEILING_REARM_BELOW && args.nudgedPercent !== undefined) {
    return { action: EPodDiskCeilingAction.Rearm }
  }
  return { action: EPodDiskCeilingAction.None }
}
