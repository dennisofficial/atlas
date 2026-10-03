import { readFile, rename, writeFile } from 'node:fs/promises'

import { z } from 'zod'

import type { ShellWindow } from './background-shell'
import type { ShellAttachment } from './port'

export const DELIVERED_CHARACTERS = 30_000
export const ENDED_READ_BYTES = 400_000
export const SCAN_BYTES = 256 * 1024

const cursorSchema = z.object({
  read: z.number().int().nonnegative(),
  watched: z.number().int().nonnegative(),
  prompted: z.number().int().nonnegative().optional(),
  pattern: z.string().optional(),
})

export type ShellCursor = z.infer<typeof cursorSchema>

export type LoadedCursor = { cursor: ShellCursor; problem?: string | undefined }

const CONTINUATION_MASK = 0xc0
const CONTINUATION = 0x80
const FIRST_MULTIBYTE = 0xc0

const sequenceLength = (lead: number): number => {
  if (lead >= 0xf0) return 4
  if (lead >= 0xe0) return 3
  return 2
}

export function completeUtf8Length(bytes: Uint8Array): number {
  const end = bytes.length
  for (let back = 0; back < 4 && end - 1 - back >= 0; back += 1) {
    const byte = bytes[end - 1 - back] ?? 0
    if ((byte & CONTINUATION_MASK) === CONTINUATION) continue
    if (byte < FIRST_MULTIBYTE) return end
    return back + 1 >= sequenceLength(byte) ? end : end - 1 - back
  }
  return end
}

export async function loadCursor({ path }: { path: string }): Promise<LoadedCursor> {
  const fresh: ShellCursor = { read: 0, watched: 0 }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return { cursor: fresh }
    return { cursor: fresh, problem: `could not read ${path}: ${String(error)}` }
  }
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(text))
    if (parsed.success) return { cursor: parsed.data }
  } catch {
    return { cursor: fresh, problem: `${path} is not valid JSON` }
  }
  return { cursor: fresh, problem: `${path} does not match the cursor schema` }
}

export async function saveCursor({
  path,
  cursor,
}: {
  path: string
  cursor: ShellCursor
}): Promise<void> {
  const staging = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(staging, JSON.stringify(cursor), { mode: 0o600 })
  await rename(staging, path)
}

export async function windowOf(args: {
  attachment: ShellAttachment
  from: number
  limit: number
  finished: boolean
}): Promise<ShellWindow> {
  const total = args.attachment.totalBytes()
  const start = Math.min(args.from, total)
  const wanted = Math.min(args.limit, total - start)
  const raw =
    wanted > 0 ? await args.attachment.readOutput({ start, limit: wanted }) : new Uint8Array()
  const reachesEnd = start + raw.length >= total
  const keep = args.finished && reachesEnd ? raw.length : completeUtf8Length(raw)
  const outputEnd = start + keep
  return {
    text: new TextDecoder().decode(raw.subarray(0, keep)),
    droppedCharacters: 0,
    remainingCharacters: Math.max(total - outputEnd, 0),
    outputStart: start,
    outputEnd,
  }
}

export async function tailOf(args: {
  attachment: ShellAttachment
  limit: number
  finished: boolean
}): Promise<string> {
  const total = args.attachment.totalBytes()
  const start = Math.max(total - args.limit, 0)
  if (total === start) return ''
  const raw = await args.attachment.readOutput({ start, limit: total - start })
  let from = 0
  while (from < raw.length && ((raw[from] ?? 0) & CONTINUATION_MASK) === CONTINUATION) from += 1
  const body = raw.subarray(from)
  const keep = args.finished ? body.length : completeUtf8Length(body)
  return new TextDecoder().decode(body.subarray(0, keep))
}
