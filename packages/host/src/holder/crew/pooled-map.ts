export const pooledMap = async <T, R>(args: {
  items: readonly T[]
  limit: number
  work: (item: T) => Promise<R>
}): Promise<R[]> => {
  const results: R[] = []
  const queue = args.items.entries()
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) results[index] = await args.work(item)
  }
  const workers = Math.max(1, Math.min(args.limit, args.items.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}
