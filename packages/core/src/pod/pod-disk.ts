export const POD_DISK_GROW_AT = 0.8
export const POD_DISK_GROW_FACTOR = 1.5

const BYTES_PER_GB = 2 ** 30

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
