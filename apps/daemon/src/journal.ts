import { type FileHandle, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

export const callDirNameSchema = /^[A-Za-z0-9_.:-]+$/

export type CallJournalState = 'running' | 'done'

export type JournalRecord = {
  state: CallJournalState
  epoch: number
  op: unknown
  bytes: number
  result?: unknown
}

export const journalRecordSchema = z.object({
  state: z.enum(['running', 'done']),
  epoch: z.number().int().min(0),
  op: z.unknown(),
  bytes: z.number().int().min(0),
  result: z.unknown().optional(),
})

export const daemonHomeFromEnv = (env: Record<string, string | undefined>): string =>
  env.ATLAS_DAEMON_HOME ?? `${env.HOME ?? ''}/.atlas-daemon`

export const callDir = (args: { home: string; key: string }): string =>
  join(args.home, 'calls', args.key)

export const readJournal = async (args: {
  home: string
  key: string
}): Promise<JournalRecord | null> => {
  if (!callDirNameSchema.test(args.key)) return null
  try {
    const raw = await readFile(join(callDir(args), 'state.json'), 'utf8')
    return journalRecordSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeFileSyncFd = async (args: { path: string; content: string }): Promise<void> => {
  let handle: FileHandle | undefined
  try {
    handle = await open(args.path, 'w')
    await handle.writeFile(args.content)
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

export const writeJournal = async (args: {
  home: string
  key: string
  record: JournalRecord
}): Promise<void> => {
  const dir = callDir(args)
  await mkdir(dir, { recursive: true })
  const staging = join(dir, `state.json.${process.pid}.tmp`)
  await writeFileSyncFd({ path: staging, content: JSON.stringify(args.record) })
  await rename(staging, join(dir, 'state.json'))
}

export const appendOutput = async (args: {
  home: string
  key: string
  bytes: Uint8Array
}): Promise<void> => {
  let handle: FileHandle | undefined
  try {
    handle = await open(join(callDir(args), 'output.bin'), 'a')
    await handle.write(args.bytes)
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

export const readOutput = async (args: {
  home: string
  key: string
  offset: number
}): Promise<Uint8Array> => {
  try {
    const bytes = new Uint8Array(await readFile(join(callDir(args), 'output.bin')))
    if (args.offset >= bytes.length) return new Uint8Array()
    return bytes.subarray(args.offset)
  } catch {
    return new Uint8Array()
  }
}

export const removeCall = async (args: { home: string; key: string }): Promise<void> => {
  if (!callDirNameSchema.test(args.key)) return
  await rm(callDir(args), { recursive: true, force: true })
}

export const pruneCalls = async (args: { home: string }): Promise<void> => {
  await rm(join(args.home, 'calls'), { recursive: true, force: true })
}

export const writeOutput = async (args: {
  home: string
  key: string
  bytes: Uint8Array
}): Promise<void> => {
  await mkdir(callDir(args), { recursive: true })
  await writeFile(join(callDir(args), 'output.bin'), args.bytes)
}
