import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { WatchStartOp } from '@dltech/atlas-protocol'
import {
  type DaemonGroup,
  type DaemonGroupFactory,
  type GroupContext,
  defineOp,
} from '@dltech/atlas-protocol/engine'

import { TreeWatch, guardedWatch } from './tree'

const DEFAULT_DEBOUNCE_MS = 150

type Closeable = { close(): void }

type WatchRecord = {
  watchId: string
  roots: readonly string[]
  basenames: ReadonlySet<string> | null
  debounceMs: number
  seq: number
  watchers: Map<string, Closeable>
  missing: Set<string>
  armed: string[]
  pending: Set<string>
  timer: ReturnType<typeof setTimeout> | null
}

const realOf = (path: string): string | null => {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

const existingAncestorOf = (path: string): string => {
  let current = dirname(path)
  while (true) {
    const real = realOf(current)
    if (real !== null) return real
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

const closeWatchers = (record: WatchRecord): void => {
  for (const watcher of record.watchers.values()) watcher.close()
  record.watchers.clear()
  record.armed = []
}

const underRoot = (args: { path: string; roots: Iterable<string> }): boolean => {
  for (const root of args.roots) {
    if (args.path === root || root.startsWith(`${args.path}/`)) return true
  }
  return false
}

const keeps = (args: { record: WatchRecord; path: string }): boolean => {
  const { record, path } = args
  if (record.basenames === null) return true
  if (record.basenames.has(basename(path))) return true
  return underRoot({ path, roots: [...record.missing, ...record.roots] })
}

const settle = (args: { record: WatchRecord; ctx: GroupContext }): void => {
  const { record, ctx } = args
  record.timer = null
  const pending = [...record.pending].sort()
  record.pending.clear()
  const paths = pending.filter((path) => keeps({ record, path }))
  if (paths.length === 0) return
  record.seq += 1
  ctx.publish({ type: 'watch.changed', watchId: record.watchId, paths })
}

const schedule = (args: { record: WatchRecord; ctx: GroupContext }): void => {
  const { record, ctx } = args
  if (record.timer !== null) clearTimeout(record.timer)
  record.timer = setTimeout(() => settle({ record, ctx }), record.debounceMs)
}

const reportWatchFailure = (args: {
  record: WatchRecord
  ctx: GroupContext
  path: string
  error: unknown
}): void => {
  const { record, ctx, path, error } = args
  console.error(
    `atlas-daemon watch ${record.watchId} lost ${path}: ${error instanceof Error ? error.message : String(error)}`,
  )
  record.pending.add(path)
  schedule({ record, ctx })
}

const armRoot = (args: { record: WatchRecord; ctx: GroupContext; root: string }): void => {
  const { record, ctx, root } = args
  const real = realOf(root)
  if (real === null) {
    const ancestor = existingAncestorOf(root)
    record.missing.add(root)
    if (record.watchers.has(ancestor)) return
    const watcher = guardedWatch({
      path: ancestor,
      recursive: false,
      onEvent: (filename) => {
        record.pending.add(filename === null ? root : join(ancestor, filename))
        schedule({ record, ctx })
        armMissing({ record, ctx })
      },
      onError: (error) => {
        record.watchers.delete(ancestor)
        reportWatchFailure({ record, ctx, path: ancestor, error })
      },
    })
    if (watcher !== null) record.watchers.set(ancestor, watcher)
    return
  }
  record.missing.delete(root)
  if (record.watchers.has(real)) return
  const tree = new TreeWatch({
    root: real,
    onChange: (path) => {
      record.pending.add(path)
      schedule({ record, ctx })
    },
    onError: (error) => reportWatchFailure({ record, ctx, path: real, error }),
  })
  record.watchers.set(real, tree)
  tree.start()
  record.armed.push(real)
}

const armMissing = (args: { record: WatchRecord; ctx: GroupContext }): void => {
  const { record, ctx } = args
  if (record.missing.size === 0) return
  for (const root of [...record.missing]) armRoot({ record, ctx, root })
}

const close = (record: WatchRecord): void => {
  if (record.timer !== null) clearTimeout(record.timer)
  record.timer = null
  record.pending.clear()
  closeWatchers(record)
}

const sameSpec = (args: { existing: WatchRecord; op: WatchStartOp }): boolean => {
  const { existing, op } = args
  if (existing.roots.length !== op.roots.length) return false
  if (!existing.roots.every((root, index) => root === op.roots[index])) return false
  const asked = op.basenames === undefined ? null : new Set(op.basenames)
  if (existing.basenames === null || asked === null) return existing.basenames === asked
  if (existing.basenames.size !== asked.size) return false
  return [...asked].every((name) => existing.basenames?.has(name) === true)
}

export const watchGroup: DaemonGroupFactory = (ctx: GroupContext): DaemonGroup => {
  const records = new Map<string, WatchRecord>()
  const instance = randomUUID()

  const start = (op: WatchStartOp): string[] => {
    const existing = records.get(op.watchId)
    if (existing !== undefined && sameSpec({ existing, op })) return [...existing.armed]
    if (existing !== undefined) close(existing)
    const record: WatchRecord = {
      watchId: op.watchId,
      roots: op.roots,
      basenames: op.basenames === undefined ? null : new Set(op.basenames),
      debounceMs: op.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      seq: 0,
      watchers: new Map(),
      missing: new Set(),
      armed: [],
      pending: new Set(),
      timer: null,
    }
    for (const root of record.roots) armRoot({ record, ctx, root })
    records.set(record.watchId, record)
    armMissing({ record, ctx })
    return [...record.armed]
  }

  return {
    name: 'watch',
    ops: [
      defineOp({ op: 'watch.start', run: ({ op }) => Promise.resolve(start(op)) }),
      defineOp({
        op: 'watch.status',
        run: ({ op }) =>
          Promise.resolve({
            instance,
            watches: op.watchIds.flatMap((watchId) => {
              const record = records.get(watchId)
              return record === undefined ? [] : [{ watchId, seq: record.seq }]
            }),
          }),
      }),
      defineOp({
        op: 'watch.stop',
        run: ({ op }) => {
          const record = records.get(op.watchId)
          if (record !== undefined) {
            close(record)
            records.delete(op.watchId)
          }
          return Promise.resolve(null)
        },
      }),
    ],
    stop: async () => {
      for (const record of records.values()) close(record)
      records.clear()
    },
  }
}

export { DEFAULT_DEBOUNCE_MS as WATCH_DEBOUNCE_MS }
