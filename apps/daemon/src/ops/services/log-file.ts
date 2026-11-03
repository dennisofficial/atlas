import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ServicesLogResult } from '@dltech/atlas-protocol'

export const LOG_DIR_LIMIT_BYTES = 32 * 1024 * 1024

export const logPathOf = (args: { home: string; serviceId: string }): string =>
  join(args.home, 'services', args.serviceId, 'log.bin')

export const openLog = (args: { home: string; serviceId: string }): number => {
  const path = logPathOf(args)
  mkdirSync(dirname(path), { recursive: true })
  return openSync(path, 'a')
}

export const appendLog = (args: {
  fd: number
  logTotalBytes: number
  bytes: Uint8Array
}): number => {
  const room = LOG_DIR_LIMIT_BYTES - args.logTotalBytes
  if (room <= 0) return args.logTotalBytes
  const slice = args.bytes.length > room ? args.bytes.subarray(0, room) : args.bytes
  writeSync(args.fd, slice)
  return args.logTotalBytes + slice.length
}

export const closeLog = (args: { fd: number }): void => {
  try {
    closeSync(args.fd)
  } catch {
    return
  }
}

export const readLog = (args: {
  home: string
  serviceId: string
  offset: number
  limit: number
}): ServicesLogResult => {
  const path = logPathOf(args)
  let totalBytes = 0
  try {
    totalBytes = statSync(path).size
  } catch {
    return { offset: args.offset, bytes: '', totalBytes: 0 }
  }
  if (args.offset >= totalBytes) return { offset: totalBytes, bytes: '', totalBytes }
  const readable = Math.min(args.limit, totalBytes - args.offset)
  const buffer = Buffer.alloc(readable)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, { offset: 0, length: readable, position: args.offset })
  } finally {
    closeSync(fd)
  }
  return { offset: args.offset, bytes: buffer.toString('base64'), totalBytes }
}
