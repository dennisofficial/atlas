export const firstIndexAfter = (args: {
  items: readonly { seq: number }[]
  seq: number
}): number => {
  let low = 0
  let high = args.items.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const item = args.items[middle]
    if (item !== undefined && item.seq <= args.seq) low = middle + 1
    else high = middle
  }
  return low
}

export const itemAtSeq = <T extends { seq: number }>(args: {
  items: readonly T[]
  seq: number
}): T | undefined => {
  const item = args.items[firstIndexAfter({ items: args.items, seq: args.seq - 1 })]
  return item?.seq === args.seq ? item : undefined
}
