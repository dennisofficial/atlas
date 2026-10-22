import { EventEmitter, errorMonitor } from 'node:events'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EPathSink, type FileRecord } from './types'

export type Fn = (...args: unknown[]) => unknown
export type Mode = 'sync' | 'callback' | 'promise' | 'stream'

export interface RecorderContext {
  repoRoot: string
  current: () => FileRecord | undefined
}

export function toRepoPath(params: { target: unknown; repoRoot: string }): string | undefined {
  const { target, repoRoot } = params
  let path: string | undefined
  if (typeof target === 'string') path = target
  else if (target instanceof URL && target.protocol === 'file:') {
    try {
      path = fileURLToPath(target)
    } catch {
      return undefined
    }
  } else if (Buffer.isBuffer(target)) path = target.toString()
  if (!path) return undefined
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path)
  if (!absolute.startsWith(`${repoRoot}/`)) return undefined
  if (absolute.includes('/node_modules/') || absolute.includes('/.git/')) return undefined
  return absolute
}

export function isRecursive(options: unknown) {
  return typeof options === 'object' && options !== null && 'recursive' in options
    ? Boolean(options.recursive)
    : false
}

export function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

function track(params: {
  original: Fn
  self: unknown
  args: unknown[]
  path: string
  sink: EPathSink
  mode: Mode
  record: FileRecord
}) {
  const { original, self, args, path, sink, mode, record } = params
  const op = { path, sink }
  const settle = (ok: boolean) => {
    if (record.pending.delete(op)) record.paths[ok ? sink : EPathSink.Stats].add(path)
  }
  record.pending.add(op)
  if (mode === 'callback') {
    let index = args.length - 1
    while (index >= 0 && typeof args[index] !== 'function') index--
    const callback = args[index]
    if (typeof callback === 'function') {
      args[index] = function (this: unknown, ...results: unknown[]) {
        settle(!results[0])
        return callback.apply(this, results)
      }
    }
  }
  let result: unknown
  try {
    result = original.apply(self, args)
  } catch (error) {
    settle(false)
    throw error
  }
  if (mode === 'sync') settle(result !== undefined)
  if (mode === 'stream' && result instanceof EventEmitter) {
    result.once('open', () => settle(true))
    result.once(errorMonitor, () => settle(false))
  }
  if (mode === 'promise' && isThenable(result)) {
    return result.then(
      (value) => {
        settle(true)
        return value
      },
      (error: unknown) => {
        settle(false)
        throw error
      },
    )
  }
  return result
}

export function wrap(params: {
  context: RecorderContext
  target: object
  names: string[]
  mode: Mode
  sink: (args: unknown[]) => EPathSink
}) {
  const { context, target, names, mode, sink } = params
  const record = target as Record<string | symbol, unknown>
  for (const name of names) {
    const value = record[name]
    if (typeof value !== 'function') continue
    const original = value as Fn
    const wrapper = function (this: unknown, ...args: unknown[]) {
      const file = context.current()
      const path = file && toRepoPath({ target: args[0], repoRoot: context.repoRoot })
      if (!file || !path) return original.apply(this, args)
      return track({ original, self: this, args, path, sink: sink(args), mode, record: file })
    }
    for (const symbol of Object.getOwnPropertySymbols(original)) {
      Object.defineProperty(
        wrapper,
        symbol,
        Object.getOwnPropertyDescriptor(original, symbol) ?? {},
      )
    }
    record[name] = wrapper
  }
}
