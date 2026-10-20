import { createHash } from 'node:crypto'

import {
  CloudError,
  cloudRequest,
  extractContextArchive,
  sandboxUserLayerTrees,
} from '@dltech/atlas-harness'
import {
  PUBLISHED_BUNDLE_MAX_BYTES,
  publishedBundleCurrentSchema,
  type PublishedBundleCurrent,
} from '@dltech/atlas-wire'

import { fileEntry, writeContextEntries } from './context-entries'
import { messageOf } from './context-readiness'
import { EServeEvent, type ServeLog } from './serve-log'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'

const CURRENT_PATH = '/v1/published-bundles/current'
const LEASE_REGISTRATION_ATTEMPTS = 10
const LEASE_REGISTRATION_DELAY_MS = 1_000
const TRANSPORT_ATTEMPTS = 2
const KEPT_KEY_PREFIXES = ['user-layer/skills/', 'user-layer/instructions/'] as const
const KEPT_EXACT_KEY = '.atlas/mcp.json'

type Sleep = (ms: number) => Promise<void>

type CurrentRequest = {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  sleep: Sleep
}

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isKeptKey = (key: string): boolean =>
  key === KEPT_EXACT_KEY || KEPT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))

const isUnauthorized = (error: unknown): boolean => error instanceof CloudError && error.status === 401

const requestCurrent = (args: CurrentRequest): Promise<unknown> =>
  cloudRequest({
    url: args.controlPlaneUrl.replace(/\/+$/, ''),
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
    method: 'GET',
    path: CURRENT_PATH,
    allowMissing: true,
    retry: true,
    maxAttempts: TRANSPORT_ATTEMPTS,
    sleep: args.sleep,
  })

const fetchCurrentBody = async (args: CurrentRequest): Promise<unknown> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestCurrent(args)
    } catch (error) {
      if (!isUnauthorized(error) || attempt >= LEASE_REGISTRATION_ATTEMPTS) throw error
      await args.sleep(LEASE_REGISTRATION_DELAY_MS)
    }
  }
}

const tooLarge = (): Error => new Error(`the bundle is larger than ${PUBLISHED_BUNDLE_MAX_BYTES} bytes`)

const downloadBundle = async (args: {
  current: PublishedBundleCurrent
  fetchFn: typeof fetch
}): Promise<Buffer> => {
  const response = await args.fetchFn(args.current.downloadUrl)
  if (!response.ok) throw new Error(`the bundle download answered ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > PUBLISHED_BUNDLE_MAX_BYTES) throw tooLarge()
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > PUBLISHED_BUNDLE_MAX_BYTES) throw tooLarge()
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== args.current.sha256) throw new Error('the bundle sha256 does not match the published version')
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
          identity: null,
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
  try {
    const body = await fetchCurrentBody({
      controlPlaneUrl: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
      sleep: args.sleep ?? defaultSleep,
    })
    if (body === undefined) {
      args.log({ event: EServeEvent.BundleAbsent })
      return
    }
    const parsed = publishedBundleCurrentSchema.safeParse(body)
    if (!parsed.success) throw new Error('the published bundle answer was malformed')
    const bytes = await downloadBundle({ current: parsed.data, fetchFn: args.fetchFn })
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
