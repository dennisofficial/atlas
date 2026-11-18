import { type FSWatcher, realpathSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'

import type { WatchStartOp } from '@dltech/atlas-protocol'
import {
  type DaemonGroup,
  type DaemonGroupFactory,
  type GroupContext,
  defineOp,
} from '@dltech/atlas-protocol/engine'

const DEFAULT_DEBOUNCE_MS = 150

type WatchRecord = {
  watchId: string
  roots: readonly string[]
  debounceMs: number
  watchers: Map<string, FSWatcher>
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

const settle = (args: { record: WatchRecord; ctx: GroupContext }): void => {
  const { record, ctx } = args
  record.timer = null
  const paths = [...record.pending].sort()
  record.pending.clear()
  if (paths.length === 0) return
  ctx.publish({ type: 'watch.changed', watchId: record.watchId, paths })
}

const schedule = (args: { record: WatchRecord; ctx: GroupContext }): void => {
  const { record, ctx } = args
  if (record.timer !== null) clearTimeout(record.timer)
  record.timer = setTimeout(() => settle({ record, ctx }), record.debounceMs)
}

const armRoot = (args: { record: WatchRecord; ctx: GroupContext; root: string }): void => {
  const { record, ctx, root } = args
  const real = realOf(root)
  if (real === null) {
    const ancestor = existingAncestorOf(root)
    record.missing.add(root)
    if (record.watchers.has(ancestor)) return
    record.watchers.set(
      ancestor,
      watch(ancestor, { persistent: true, recursive: false }, (_event, filename) => {
        record.pending.add(filename === null ? root : join(ancestor, filename))
        schedule({ record, ctx })
      }),
    )
    return
  }
  record.missing.delete(root)
  if (record.watchers.has(real)) return
  record.watchers.set(
    real,
    watch(real, { persistent: true, recursive: true }, (_event, filename) => {
      record.pending.add(filename === null ? real : join(real, filename))
      schedule({ record, ctx })
    }),
  )
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

export const watchGroup: DaemonGroupFactory = (ctx: GroupContext): DaemonGroup => {
  const records = new Map<string, WatchRecord>()

  const start = (op: WatchStartOp): string[] => {
    const existing = records.get(op.watchId)
    if (existing !== undefined) close(existing)
    const record: WatchRecord = {
      watchId: op.watchId,
      roots: op.roots,
      debounceMs: op.debounceMs ?? DEFAULT_DEBOUNCE_MS,
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
