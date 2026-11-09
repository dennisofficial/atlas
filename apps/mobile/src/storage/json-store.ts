export type JsonEntry = { name: string; modifiedAt: number }

export type JsonStore = {
  read: (name: string) => Promise<unknown>
  write: (name: string, value: unknown) => Promise<void>
  remove: (name: string) => Promise<void>
  list: () => Promise<readonly JsonEntry[]>
  clear: () => Promise<void>
}

export const serializedStore = (store: JsonStore): JsonStore => {
  let chain: Promise<void> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = chain.then(operation)
    chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  return {
    read: (name) => enqueue(() => store.read(name)),
    write: (name, value) => enqueue(() => store.write(name, value)),
    remove: (name) => enqueue(() => store.remove(name)),
    list: () => enqueue(() => store.list()),
    clear: () => enqueue(() => store.clear()),
  }
}

export const memoryJsonStore = (args: { now?: (() => number) | undefined } = {}): JsonStore => {
  const now = args.now ?? (() => Date.now())
  const files = new Map<string, { value: unknown; modifiedAt: number }>()
  return {
    read: (name) => Promise.resolve(files.get(name)?.value),
    write: (name, value) => {
      files.set(name, { value, modifiedAt: now() })
      return Promise.resolve()
    },
    remove: (name) => {
      files.delete(name)
      return Promise.resolve()
    },
    list: () =>
      Promise.resolve([...files].map(([name, held]) => ({ name, modifiedAt: held.modifiedAt }))),
    clear: () => {
      files.clear()
      return Promise.resolve()
    },
  }
}

export const failingJsonStore = (): JsonStore => {
  const fail = (): Promise<never> => Promise.reject(new Error('the store is unavailable'))
  return { read: fail, write: fail, remove: fail, list: fail, clear: fail }
}
