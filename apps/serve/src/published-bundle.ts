import { createHash } from 'node:crypto'

import { extractContextArchive, sandboxUserLayerTrees } from '@dltech/atlas-harness'
import {
  PUBLISHED_BUNDLE_MAX_BYTES,
  publishedBundleCurrentSchema,
  type PublishedBundleCurrent,
} from '@dltech/atlas-wire'

import { createApiClient, httpStatusOf } from './api-client'
import { fileEntry, writeContextEntries } from './context-entries'
import { messageOf } from './context-readiness'
import { EServeEvent, type ServeLog } from './serve-log'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'

const LEASE_REGISTRATION_ATTEMPTS = 10
const LEASE_REGISTRATION_DELAY_MS = 1_000
const REQUEST_TIMEOUT_MS = 10_000
const BOOT_BUDGET_MS = 60_000
const KEPT_KEY_PREFIXES = ['user-layer/skills/', 'user-layer/instructions/'] as const
const KEPT_EXACT_KEY = '.atlas/mcp.json'

type Sleep = (ms: number) => Promise<void>

type CurrentRequest = {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  sleep: Sleep
  deadline: number
}

const remainingMs = (deadline: number): number => {
  const left = deadline - Date.now()
  if (left <= 0) throw new Error(`the published bundle did not arrive within ${BOOT_BUDGET_MS} ms`)
  return left
}

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isKeptKey = (key: string): boolean =>
  key === KEPT_EXACT_KEY || KEPT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))

const isUnauthorized = (error: unknown): boolean => httpStatusOf(error) === 401

const requestCurrent = async (args: CurrentRequest): Promise<unknown> => {
  const signal = AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs(args.deadline)))
  try {
    return await createApiClient({
      controlPlaneUrl: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
    }).publishedBundles.current.query(undefined, { signal })
  } catch (error) {
    if (httpStatusOf(error) === 404) return undefined
    throw error
  }
}

const fetchCurrentBody = async (args: CurrentRequest): Promise<unknown> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestCurrent(args)
    } catch (error) {
      if (!isUnauthorized(error) || attempt >= LEASE_REGISTRATION_ATTEMPTS) throw error
      await args.sleep(Math.min(LEASE_REGISTRATION_DELAY_MS, remainingMs(args.deadline)))
    }
  }
}

const tooLarge = (): Error =>
  new Error(`the bundle is larger than ${PUBLISHED_BUNDLE_MAX_BYTES} bytes`)

const downloadBundle = async (args: {
  current: PublishedBundleCurrent
  fetchFn: typeof fetch
  deadline: number
}): Promise<Buffer> => {
  const response = await args.fetchFn(args.current.downloadUrl, {
    signal: AbortSignal.timeout(remainingMs(args.deadline)),
  })
  if (!response.ok) throw new Error(`the bundle download answered ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > PUBLISHED_BUNDLE_MAX_BYTES) throw tooLarge()
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > PUBLISHED_BUNDLE_MAX_BYTES) throw tooLarge()
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== args.current.sha256)
    throw new Error('the bundle sha256 does not match the published version')
  return bytes
}

const writeBundle = async (args: {
  bytes: Buffer
  atlasHome: string
  projectDirectory: string
  files: WorkspaceFiles
}): Promise<number> => {
  const extracted = await extractContextArchive({ archive: args.bytes })
  try {
    const entries = extracted.entries
      .filter((entry) => isKeptKey(entry.key))
      .map((entry) => fileEntry({ key: entry.key, path: entry.path }))
    const outcome = await writeContextEntries({
      files: args.files,
      entries,
      targets: {
        atlasHome: args.atlasHome,
        userLayerTrees: sandboxUserLayerTrees({
          atlasHome: args.atlasHome,
          projectDirectory: args.projectDirectory,
        }),
      },
      overwrite: true,
    })
    if (outcome.failed !== null) throw new Error(outcome.failed)
    return outcome.written
  } finally {
    await extracted.cleanup()
  }
}

export const applyPublishedBundle = async (args: {
  atlasHome: string
  projectDirectory: string
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  log: ServeLog
  files?: WorkspaceFiles | undefined
  sleep?: Sleep | undefined
}): Promise<void> => {
  const startedAt = Date.now()
  const deadline = startedAt + BOOT_BUDGET_MS
  try {
    const body = await fetchCurrentBody({
      controlPlaneUrl: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
      sleep: args.sleep ?? defaultSleep,
      deadline,
    })
    if (body === undefined) {
      args.log({ event: EServeEvent.BundleAbsent })
      return
    }
    const parsed = publishedBundleCurrentSchema.safeParse(body)
    if (!parsed.success) throw new Error('the published bundle answer was malformed')
    const bytes = await downloadBundle({ current: parsed.data, fetchFn: args.fetchFn, deadline })
    const written = await writeBundle({
      bytes,
      atlasHome: args.atlasHome,
      projectDirectory: args.projectDirectory,
      files: args.files ?? nodeWorkspaceFiles,
    })
    args.log({
      event: EServeEvent.BundleReady,
      version: parsed.data.version,
      written,
      ms: Date.now() - startedAt,
    })
  } catch (error) {
    args.log({ event: EServeEvent.BundleFailed, reason: messageOf(error) })
  }
}
