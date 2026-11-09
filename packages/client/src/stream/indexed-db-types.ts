export type IdbRequest<T> = {
  onsuccess: unknown
  onerror: unknown
  result: T
  error: unknown
}

export type IdbTransaction = {
  oncomplete: unknown
  onerror: unknown
  onabort: unknown
  error: unknown
  objectStore: (name: string) => IdbObjectStore
  abort: () => void
}

export type IdbObjectStore = {
  get: (key: string) => IdbRequest<unknown>
  put: (value: unknown, key?: string) => IdbRequest<unknown>
  delete: (key: string) => IdbRequest<unknown>
  clear: () => IdbRequest<unknown>
  getAll: () => IdbRequest<unknown[]>
  getAllKeys: () => IdbRequest<unknown[]>
}

export type IdbDatabase = {
  objectStoreNames: { contains: (name: string) => boolean }
  createObjectStore: (name: string) => unknown
  transaction: (stores: string, mode: 'readonly' | 'readwrite') => IdbTransaction
  close: () => void
}

export type IdbOpenRequest = IdbRequest<IdbDatabase> & {
  onupgradeneeded: unknown
  onblocked: unknown
}

export type IdbFactory = { open: (name: string, version?: number) => IdbOpenRequest }

export const defaultIndexedDbFactory = (): IdbFactory | undefined =>
  (globalThis as { indexedDB?: IdbFactory }).indexedDB
