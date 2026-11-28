export type ByteCount = number | bigint

export const uploadFractionOf = (args: {
  bytesSent: ByteCount
  totalBytes: ByteCount
}): number | undefined => {
  const total = Number(args.totalBytes)
  if (!(total > 0)) return undefined
  return Math.min(1, Math.max(0, Number(args.bytesSent) / total))
}
