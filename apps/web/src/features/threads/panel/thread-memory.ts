import type { z } from 'zod'

export const MAX_REMEMBERED_THREADS = 200

export type ThreadMemories<T> = Record<string, T>

type MemoryStorage = Pick<Storage, 'getItem' | 'setItem'>

const jsonOf = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseThreadMemories<T>(args: {
  raw: string | null
  schema: z.ZodType<T>
}): ThreadMemories<T> {
  if (args.raw === null) return {}
  const json = jsonOf(args.raw)
  if (!isRecord(json)) return {}
  const entries = Object.entries(json).flatMap(([threadId, value]) => {
    const parsed = args.schema.safeParse(value)
    return parsed.success ? [[threadId, parsed.data] as const] : []
  })
  return Object.fromEntries(entries)
}

export function withThreadMemory<T>(args: {
  memories: ThreadMemories<T>
  threadId: string
  memory: T
}): ThreadMemories<T> {
  const { [args.threadId]: _replaced, ...rest } = args.memories
  const entries = [...Object.entries(rest), [args.threadId, args.memory] as const]
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_THREADS))
}

const browserStorage = (): MemoryStorage | undefined => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function createThreadMemory<T>(args: {
  key: string
  schema: z.ZodType<T>
  storage?: () => MemoryStorage | undefined
}) {
  const storageOf = args.storage ?? browserStorage
  const readAll = (): ThreadMemories<T> => {
    try {
      return parseThreadMemories({
        raw: storageOf()?.getItem(args.key) ?? null,
        schema: args.schema,
      })
    } catch {
      return {}
    }
  }

  return {
    recall: (threadId: string): T | undefined => readAll()[threadId],
    remember: (change: { threadId: string; memory: T }): void => {
      const next = withThreadMemory({ memories: readAll(), ...change })
      try {
        storageOf()?.setItem(args.key, JSON.stringify(next))
      } catch {}
    },
  }
}
