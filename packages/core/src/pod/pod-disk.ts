export const POD_DISK_GROW_AT = 0.8
export const POD_DISK_GROW_FACTOR = 2
export const POD_DISK_URGENT_AT = 0.95
export const POD_DISK_URGENT_FREE_BYTES = 2 * 2 ** 30

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
  if (usedBytes / args.limitBytes >= POD_DISK_URGENT_AT) return EPodDiskPressure.Urgent
  if (args.limitBytes - usedBytes < POD_DISK_URGENT_FREE_BYTES) return EPodDiskPressure.Urgent
  if (usedBytes / args.limitBytes >= POD_DISK_GROW_AT) return EPodDiskPressure.Grow
  return EPodDiskPressure.Fine
}

export const podDiskGrowthOf = (args: {
  usedBytes: number
  limitBytes: number
  maxGb: number
}): number | undefined => {
  if (args.limitBytes <= 0) return undefined
  if (args.usedBytes / args.limitBytes < POD_DISK_GROW_AT) return undefined
  const limitGb = Math.round(args.limitBytes / BYTES_PER_GB)
  if (limitGb >= args.maxGb) return undefined
  return Math.min(args.maxGb, Math.ceil(limitGb * POD_DISK_GROW_FACTOR))
}
