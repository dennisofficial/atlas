export type IdbRequest<T> = {
  onsuccess: unknown
  onerror: unknown
  result: T
  error: unknown
}

export type IdbKeyRange = unknown

export type IdbCursor = {
  value: unknown
  continue: () => void
  delete: () => void
}

export type IdbCursorRequest = IdbRequest<IdbCursor | null> & { onsuccess: unknown }

export type IdbTransaction = {
  oncomplete: unknown
  onerror: unknown
  onabort: unknown
  error: unknown
  objectStore: (name: string) => IdbObjectStore
  abort: () => void
}

export type IdbObjectStore = {
  get: (key: unknown) => IdbRequest<unknown>
  put: (value: unknown) => IdbRequest<unknown>
  delete: (key: unknown) => IdbRequest<unknown>
  clear: () => IdbRequest<unknown>
  getAll: (range?: IdbKeyRange) => IdbRequest<unknown[]>
  getAllKeys: (range?: IdbKeyRange) => IdbRequest<unknown[]>
  openCursor: (range?: IdbKeyRange, direction?: 'next' | 'prev') => IdbCursorRequest
  index: (name: string) => IdbObjectStore
}

export type IdbDatabase = {
  onclose: unknown
  onversionchange: unknown
  objectStoreNames: { contains: (name: string) => boolean }
  createObjectStore: (name: string, options?: { keyPath: string | string[] }) => unknown
  deleteObjectStore: (name: string) => unknown
  transaction: (stores: string | string[], mode: 'readonly' | 'readwrite') => IdbTransaction
  close: () => void
}

export type IdbOpenRequest = IdbRequest<IdbDatabase> & {
  onupgradeneeded: unknown
  onblocked: unknown
}

export type IdbFactory = { open: (name: string, version?: number) => IdbOpenRequest }

export type IdbKeyRangeFactory = {
  bound: (lower: unknown, upper: unknown) => IdbKeyRange
  lowerBound: (lower: unknown) => IdbKeyRange
  upperBound: (upper: unknown) => IdbKeyRange
}

export const defaultIndexedDbFactory = (): IdbFactory | undefined =>
  (globalThis as unknown as { indexedDB?: IdbFactory }).indexedDB

export const defaultKeyRangeFactory = (): IdbKeyRangeFactory | undefined =>
  (globalThis as unknown as { IDBKeyRange?: IdbKeyRangeFactory }).IDBKeyRange
