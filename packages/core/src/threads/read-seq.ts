export const nextReadSeq = (args: {
  existing: number | undefined
  seq: number
  head: number
}): number => {
  const target = Math.min(args.seq, args.head)
  const { existing } = args
  if (existing === undefined) return target
  return existing <= args.head ? Math.max(existing, target) : target
}
