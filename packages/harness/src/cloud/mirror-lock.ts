import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { holderIsLive, ownIdentity } from '../workspace/process-identity'

const MIRROR_LOCK_SUFFIX = '.mirror.lock'
const RETRY_MS = 5
const GIVE_UP_MS = 30_000

const holderSchema = z.object({ pid: z.number(), start: z.string().optional() })

export const mirrorLockFile = (args: { eventsFile: string }): string =>
  `${args.eventsFile}${MIRROR_LOCK_SUFFIX}`

const tryClaim = async (args: { lock: string; contents: string }): Promise<boolean> => {
  const staged = `${args.lock}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(staged, args.contents)
  try {
    await link(staged, args.lock)
    return true
  } catch {
    return false
  } finally {
    await unlink(staged).catch(() => undefined)
  }
}

const STALE_CHECK_EVERY = 20

const parseHolder = (text: string): z.infer<typeof holderSchema> | null => {
  try {
    const parsed = holderSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const holderIsGone = async (text: string): Promise<boolean> => {
  const holder = parseHolder(text)
  if (holder === null) return true
  return !(await holderIsLive({ pid: holder.pid, start: holder.start }))
}

const stealIfStale = async (lock: string): Promise<void> => {
  const seen = await readFile(lock, 'utf8').catch(() => null)
  if (seen === null || !(await holderIsGone(seen))) return
  const moved = `${lock}.${process.pid}.${crypto.randomUUID()}.stale`
  if (
    !(await rename(lock, moved).then(
      () => true,
      () => false,
    ))
  )
    return
  const taken = await readFile(moved, 'utf8').catch(() => null)
  if (taken !== seen) await link(moved, lock).catch(() => undefined)
  await unlink(moved).catch(() => undefined)
}

let identity: string | null = null

const ownContents = async (): Promise<string> => {
  identity ??= JSON.stringify(await ownIdentity())
  return identity
}

/** Cross-process exclusion for writers sharing one session file, such as the TUI and the Mac host. */
export async function withMirrorLock<T>(args: {
  eventsFile: string
  run: () => Promise<T>
}): Promise<T> {
  const lock = mirrorLockFile({ eventsFile: args.eventsFile })
  await mkdir(dirname(lock), { recursive: true })
  const contents = await ownContents()
  const deadline = Date.now() + GIVE_UP_MS
  for (let attempt = 0; !(await tryClaim({ lock, contents })); attempt += 1) {
    if (attempt % STALE_CHECK_EVERY === 0) await stealIfStale(lock)
    if (Date.now() > deadline) throw new Error(`the session file ${args.eventsFile} stayed locked`)
    await Bun.sleep(RETRY_MS)
  }
  try {
    return await args.run()
  } finally {
    await unlink(lock).catch(() => undefined)
  }
}
