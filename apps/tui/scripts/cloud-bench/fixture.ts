import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import {
  assertShellsTerminal,
  isPortableSessionFile,
} from '../../../../packages/harness/src/cloud/portable-session-file'
import { walkRegularFiles } from '../../../../packages/harness/src/cloud/session-walker'
import {
  sessionMetaSchema,
  threadMetaSchema,
} from '../../../../packages/harness/src/store/sessions/meta'
import {
  sessionDirectory,
  THREAD_META_FILE_SUFFIX,
} from '../../../../packages/harness/src/store/sessions/paths'
import {
  classifyKey,
  EFixtureFile,
  isRecord,
  isThreadMetaTemp,
  mappedKey,
  rewriteJsonLines,
  rewriteRootMeta,
  rewriteThreadMeta,
  threadIdOfKey,
  threadMetaIdOf,
  type IdMap,
  type JsonRecord,
} from './fixture-rewrite'

export type CloneBenchmarkSessionArgs = {
  sourceSession: string
  destinationHome: string
  workspace: string
  nextId?: (() => string) | undefined
}

export type ClonedBenchmarkSession = {
  threadId: ThreadId
  threadIds: readonly ThreadId[]
  sessionDirectory: string
  sourceBytes: number
  copiedBytes: number
  files: number
  events: number
}

export class BenchmarkCloneError extends Error {
  readonly sessionDirectory: string

  constructor(args: { sessionDirectory: string; cause: unknown }) {
    const reason = args.cause instanceof Error ? args.cause.message : String(args.cause)
    super(`benchmark clone failed; partial artifact kept at ${args.sessionDirectory}: ${reason}`, {
      cause: args.cause,
    })
    this.name = 'BenchmarkCloneError'
    this.sessionDirectory = args.sessionDirectory
  }
}

const defaultNextId = (): string => `brn_${randomUUID()}`

const errorCodeOf = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined

const canonicalPath = async (path: string): Promise<string> => {
  try {
    return await realpath(path)
  } catch (error) {
    if (errorCodeOf(error) !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) return path
    return join(await canonicalPath(parent), basename(path))
  }
}

const isInside = ({ parent, child }: { parent: string; child: string }): boolean => {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

const readJsonRecord = async ({ file }: { file: string }): Promise<JsonRecord> => {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`${file} is not a JSON object`)
  return parsed
}

const assertSafeId = ({ id }: { id: string }): void => {
  if (
    id === '' ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes(sep) ||
    id.includes('\0')
  ) {
    throw new Error(`unsafe benchmark thread id: ${JSON.stringify(id)}`)
  }
}

const assignIds = ({
  oldIds,
  nextId,
}: {
  oldIds: readonly string[]
  nextId: () => string
}): IdMap => {
  const ids = new Map<string, string>()
  const taken = new Set(oldIds)
  for (const oldId of oldIds) {
    const id = nextId()
    assertSafeId({ id })
    if (taken.has(id)) throw new Error(`benchmark thread id ${id} collides with another id`)
    taken.add(id)
    ids.set(oldId, id)
  }
  return ids
}

const REFERENCE_FIELDS = ['parentThreadId', 'spawnerThreadId'] as const

const assertNoExternalReferences = async ({
  source,
  ids,
}: {
  source: string
  ids: readonly string[]
}): Promise<void> => {
  const known = new Set(ids)
  for (const id of ids) {
    const meta = await readJsonRecord({
      file: join(source, 'threads', `${id}${THREAD_META_FILE_SUFFIX}`),
    })
    for (const field of REFERENCE_FIELDS) {
      const target = meta[field]
      if (typeof target === 'string' && !known.has(target)) {
        throw new Error(
          `thread ${id} has ${field} ${target} outside this session; cloning would lose that history`,
        )
      }
    }
  }
}

const discoverThreadIds = async ({
  source,
  keys,
}: {
  source: string
  keys: readonly string[]
}): Promise<{ rootId: string; oldIds: readonly string[] }> => {
  const root = await readJsonRecord({ file: join(source, 'meta.json') })
  const parsedRoot = sessionMetaSchema.safeParse(root)
  if (!parsedRoot.success)
    throw new Error(`invalid root metadata in ${source}: ${parsedRoot.error.message}`)
  const found = keys.flatMap((key) => threadMetaIdOf({ key }) ?? [])
  if (!found.includes(parsedRoot.data.id)) {
    throw new Error(`root thread ${parsedRoot.data.id} has no thread metadata in ${source}`)
  }
  const orphan = keys
    .flatMap((key) => threadIdOfKey({ key }) ?? [])
    .find((id) => !found.includes(id))
  if (orphan !== undefined)
    throw new Error(`thread ${orphan} has files but no thread metadata in ${source}`)
  await assertNoExternalReferences({ source, ids: found })
  const children = found.filter((id) => id !== parsedRoot.data.id).sort()
  return { rootId: parsedRoot.data.id, oldIds: [parsedRoot.data.id, ...children] }
}

type Totals = { sourceBytes: number; copiedBytes: number; events: number }

const copyOne = async ({
  source,
  target,
  key,
  ids,
  rootId,
  workspace,
  totals,
}: {
  source: string
  target: string
  key: string
  ids: IdMap
  rootId: string
  workspace: string
  totals: Totals
}): Promise<void> => {
  const from = join(source, key)
  const to = join(target, mappedKey({ key, ids }))
  await mkdir(dirname(to), { recursive: true })
  const kind = classifyKey({ key })
  const size = (await lstat(from)).size
  totals.sourceBytes += size
  if (kind === EFixtureFile.Opaque) {
    await copyFile(from, to, constants.COPYFILE_EXCL)
    totals.copiedBytes += size
    return
  }
  const text = await readFile(from, 'utf8')
  const rewritten = rewrittenText({ kind, key, text, ids, rootId, workspace, totals })
  await writeFile(to, rewritten, { flag: 'wx' })
  totals.copiedBytes += Buffer.byteLength(rewritten)
}

const rewrittenText = ({
  kind,
  key,
  text,
  ids,
  rootId,
  workspace,
  totals,
}: {
  kind: EFixtureFile
  key: string
  text: string
  ids: IdMap
  rootId: string
  workspace: string
  totals: Totals
}): string => {
  if (kind === EFixtureFile.Ledger) return rewriteJsonLines({ text, ids }).text
  if (kind === EFixtureFile.ThreadEvents) {
    const rewritten = rewriteJsonLines({ text, ids })
    totals.events += rewritten.lines
    return rewritten.text
  }
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error(`${key} is not a JSON object`)
  if (kind === EFixtureFile.RootMeta) {
    return JSON.stringify(rewriteRootMeta({ meta: parsed, ids, rootId, workspace }), null, 2)
  }
  const threadId = ids.get(threadMetaIdOf({ key }) ?? '')
  if (threadId === undefined) throw new Error(`${key} names a thread the clone does not know`)
  const meta = rewriteThreadMeta({ meta: parsed, ids, threadId, workspace })
  if (!threadMetaSchema.safeParse(meta).success)
    throw new Error(`invalid thread metadata in ${key}`)
  return JSON.stringify(meta, null, 2)
}

export async function cloneBenchmarkSession(
  args: CloneBenchmarkSessionArgs,
): Promise<ClonedBenchmarkSession> {
  const source = await realpath(args.sourceSession)
  const home = await canonicalPath(resolve(args.destinationHome))
  if (isInside({ parent: source, child: home })) {
    throw new Error(`destination home ${home} is inside the source session ${source}`)
  }
  const keys = (await walkRegularFiles({ root: source })) ?? []
  const { rootId, oldIds } = await discoverThreadIds({ source, keys })
  const portable = keys.filter(
    (key) => isPortableSessionFile({ key }) && !isThreadMetaTemp({ key }),
  )
  await assertShellsTerminal({ sessionDir: source, keys: portable })
  const ids = assignIds({ oldIds, nextId: args.nextId ?? defaultNextId })
  const newRoot = ids.get(rootId) ?? rootId
  const target = sessionDirectory({ home, sessionId: newRoot })
  await mkdir(dirname(target))
  await mkdir(target)

  const totals: Totals = { sourceBytes: 0, copiedBytes: 0, events: 0 }
  try {
    for (const key of portable) {
      await copyOne({
        source,
        target,
        key,
        ids,
        rootId: newRoot,
        workspace: resolve(args.workspace),
        totals,
      })
    }
  } catch (cause) {
    throw new BenchmarkCloneError({ sessionDirectory: target, cause })
  }
  return {
    threadId: toThreadId(newRoot),
    threadIds: oldIds.map((id) => toThreadId(ids.get(id) ?? id)),
    sessionDirectory: target,
    ...totals,
    files: portable.length,
  }
}
