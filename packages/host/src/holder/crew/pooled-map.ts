import { Sema } from 'async-sema'

export const pooledMap = async <T, R>(args: {
  items: readonly T[]
  limit: number
  work: (item: T) => Promise<R>
}): Promise<R[]> => {
  const sema = new Sema(args.limit)
  return Promise.all(
    args.items.map(async (item) => {
      await sema.acquire()
      try {
        return await args.work(item)
      } finally {
        sema.release()
      }
    }),
  )
}
