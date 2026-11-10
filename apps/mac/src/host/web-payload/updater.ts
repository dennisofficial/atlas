import { decidePayload, EPayloadDecision, parseManifest, type WebManifest } from './manifest'
import { installPayload, type IWebPayloadFs } from './install'
import { selectedPayload, stalePayloads } from './select'
import { failedState, type IPayloadState } from './state'

export const WEB_MANIFEST_URL =
  'https://github.com/dennisofficial/atlas/releases/download/web-ota/web-update.json'
export const WEB_MANIFEST_URL_ENV = 'ATLAS_WEB_PAYLOAD_URL'
export const WEB_ROOT_ENV = 'ATLAS_WEB_ROOT'
export const WEB_UPDATE_INTERVAL_MS = 5 * 60 * 1000
// A merge publishes a payload every few minutes, so offering a reload for each one makes the card a
// permanent fixture. After a reload the card stays quiet for this long; Check for Updates still
// applies a pending payload on request.
export const QUIET_AFTER_RELOAD_MS = 15 * 60 * 1000

export enum EWebPayloadState {
  Idle = 'idle',
  Ready = 'ready',
}

export interface IWebPayloadStatus {
  state: EWebPayloadState
  version?: string
  hash?: string
  builtAt?: string
  error?: string
}

export interface IWebUpdaterPorts {
  fs: IWebPayloadFs
  fetchJson: (url: string) => Promise<unknown>
  download: (url: string) => Promise<Uint8Array>
  sha256: (bytes: Uint8Array) => string
  log: (args: { label: string; error: unknown }) => void
  now: () => number
  setInterval: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval: (timer: ReturnType<typeof setInterval>) => void
}

export interface IWebUpdater {
  start: () => void
  stop: () => void
  check: (args?: { force?: boolean }) => Promise<IWebPayloadStatus>
  status: () => IWebPayloadStatus
  pending: () => string | undefined
  applied: () => void
  installedRoot: () => Promise<string | undefined>
  fail: (args: { hash: string }) => Promise<void>
}

function buildOf(manifest: WebManifest): Pick<IWebPayloadStatus, 'version' | 'hash' | 'builtAt'> {
  const build: Pick<IWebPayloadStatus, 'hash' | 'builtAt'> = {
    hash: manifest.hash,
    builtAt: manifest.builtAt,
  }
  return manifest.version === undefined ? build : { ...build, version: manifest.version }
}

export function createWebUpdater({
  home,
  manifestUrl,
  contract,
  appVersion,
  ports,
  intervalMs = WEB_UPDATE_INTERVAL_MS,
}: {
  home: string
  manifestUrl: string
  contract: number
  appVersion: string
  ports: IWebUpdaterPorts
  intervalMs?: number
}): IWebUpdater {
  let status: IWebPayloadStatus = { state: EWebPayloadState.Idle }
  let pending: string | undefined
  let reloadedAt: number | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const fail = (message: string): IWebPayloadStatus => {
    status = { state: EWebPayloadState.Idle, error: message }
    return status
  }

  const quiet = (force: boolean): boolean =>
    !force && reloadedAt !== undefined && ports.now() - reloadedAt < QUIET_AFTER_RELOAD_MS

  const check = async ({ force = false }: { force?: boolean } = {}): Promise<IWebPayloadStatus> => {
    try {
      const manifest = parseManifest({ input: await ports.fetchJson(manifestUrl) })
      if (manifest === undefined) return fail('the update manifest is invalid')
      const state = await ports.fs.readState(home)
      const decision = decidePayload({ manifest, current: state.current, contract })
      if (decision.decision === EPayloadDecision.Refuse) return fail(decision.reason)
      if (decision.decision === EPayloadDecision.Current) {
        pending = undefined
        status = { state: EWebPayloadState.Idle, ...buildOf(manifest) }
        return status
      }
      const result = await installPayload({
        home,
        manifest,
        manifestUrl,
        fs: ports.fs,
        download: ports.download,
        sha256: ports.sha256,
        appVersion,
      })
      if (!result.installed) return fail(`the payload did not install: ${result.reason}`)
      await prune({ home, ports })
      pending = result.hash
      status = {
        state: quiet(force) ? EWebPayloadState.Idle : EWebPayloadState.Ready,
        ...buildOf(manifest),
      }
      return status
    } catch (error) {
      ports.log({ label: 'web-payload', error })
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    start: () => {
      void check()
      if (timer !== undefined) return
      timer = ports.setInterval(() => void check(), intervalMs)
    },
    stop: () => {
      if (timer === undefined) return
      ports.clearInterval(timer)
      timer = undefined
    },
    check,
    status: () => status,
    pending: () => pending,
    applied: () => {
      pending = undefined
      reloadedAt = ports.now()
      if (status.state === EWebPayloadState.Ready)
        status = { ...status, state: EWebPayloadState.Idle }
    },
    installedRoot: async () => {
      const state: IPayloadState = await ports.fs.readState(home)
      if (state.appVersion !== appVersion) return undefined
      return selectedPayload({
        state,
        isComplete: (hash) => ports.fs.isComplete({ home, hash }),
      })
    },
    fail: async ({ hash }) => {
      const state = await ports.fs.readState(home)
      await ports.fs.writeState({ home, state: failedState({ state, hash }) })
      pending = undefined
      status = { state: EWebPayloadState.Idle, error: 'the new interface could not start' }
    },
  }
}

async function prune({ home, ports }: { home: string; ports: IWebUpdaterPorts }): Promise<void> {
  const state = await ports.fs.readState(home)
  for (const hash of stalePayloads({ dirs: ports.fs.list(home), state }))
    ports.fs.discard({ home, hash })
}
