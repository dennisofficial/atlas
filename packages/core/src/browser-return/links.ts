import { EReturnSurface, type ReturnTarget } from './target'

export const BROWSER_RETURN_START_PATH = '/return/start'
export const RETURN_SURFACE_PARAM = 'surface'
export const RETURN_PORT_PARAM = 'port'
export const RETURN_RESULT_PARAM = 'atlasReturn'
export const RETURN_STATE_PARAM = 'atlasState'
export const RETURN_REASON_PARAM = 'atlasReason'
export const RETURN_PARAMS = [RETURN_RESULT_PARAM, RETURN_STATE_PARAM, RETURN_REASON_PARAM] as const
export const APP_URL_SCHEME = 'atlas'
export const DESKTOP_OPEN_HOST = 'open'
export const LOOPBACK_HOST = '127.0.0.1'
export const LOOPBACK_PATH = '/atlas-return'
export const IOS_RETURN_URL = `${APP_URL_SCHEME}://`

export enum EReturnResult {
  Connected = 'connected',
  Failed = 'failed',
}

export type ReturnOutcome = { result: EReturnResult; reason?: string | undefined }

export type BrowserReturn = { state: string; outcome: ReturnOutcome }

const MAX_REASON_LENGTH = 200

export const parsedUrlOf = (url: string): URL | undefined => {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

export const startLinkOf = (args: { origin: string; state: string }): string =>
  `${new URL(args.origin).origin}${BROWSER_RETURN_START_PATH}/${encodeURIComponent(args.state)}`

const startStateOf = (url: URL): string | undefined => {
  const prefix = `${BROWSER_RETURN_START_PATH}/`
  if (!url.pathname.startsWith(prefix)) return undefined
  const state = decodeURIComponent(url.pathname.slice(prefix.length))
  return state.length === 0 ? undefined : state
}

export const isStartLink = (url: string): boolean => {
  const parsed = parsedUrlOf(url)
  return parsed !== undefined && startStateOf(parsed) !== undefined
}

export const stateOfStartLink = (url: string): string | undefined => {
  const parsed = parsedUrlOf(url)
  return parsed === undefined ? undefined : startStateOf(parsed)
}

export const startLinkFor = (args: {
  url: string
  surface: EReturnSurface
  port?: number | undefined
}): string => {
  const parsed = parsedUrlOf(args.url)
  if (parsed === undefined || startStateOf(parsed) === undefined) return args.url
  parsed.searchParams.set(RETURN_SURFACE_PARAM, args.surface)
  if (args.port === undefined) parsed.searchParams.delete(RETURN_PORT_PARAM)
  else parsed.searchParams.set(RETURN_PORT_PARAM, String(args.port))
  return parsed.toString()
}

const searchOf = (args: { state: string; outcome: ReturnOutcome; base?: URLSearchParams }) => {
  const params = new URLSearchParams(args.base)
  params.set(RETURN_RESULT_PARAM, args.outcome.result)
  params.set(RETURN_STATE_PARAM, args.state)
  if (args.outcome.reason !== undefined)
    params.set(RETURN_REASON_PARAM, args.outcome.reason.slice(0, MAX_REASON_LENGTH))
  return `?${params.toString()}`
}

export type ReturnLink =
  | { kind: 'redirect'; url: string }
  | { kind: 'app'; url: string; webUrl: string }

export const returnLinkOf = (args: {
  target: ReturnTarget
  webOrigin: string
  path: string
  state: string
  outcome: ReturnOutcome
}): ReturnLink => {
  const web = new URL(args.path, new URL(args.webOrigin).origin)
  const search = searchOf({ state: args.state, outcome: args.outcome, base: web.searchParams })
  const webUrl = `${web.origin}${web.pathname}${search}`
  if (args.target.surface === EReturnSurface.Tui && args.target.port !== undefined)
    return {
      kind: 'redirect',
      url: `http://${LOOPBACK_HOST}:${args.target.port}${LOOPBACK_PATH}${search}`,
    }
  if (args.target.surface === EReturnSurface.Desktop)
    return {
      kind: 'app',
      url: `${APP_URL_SCHEME}://${DESKTOP_OPEN_HOST}${web.pathname}${search}`,
      webUrl,
    }
  if (args.target.surface === EReturnSurface.Ios)
    return { kind: 'app', url: `${APP_URL_SCHEME}://${web.pathname}${search}`, webUrl }
  return { kind: 'redirect', url: webUrl }
}

const resultOf = (value: string | null): EReturnResult | undefined =>
  Object.values(EReturnResult).find((result) => result === value)

export const browserReturnOf = (url: string): BrowserReturn | undefined => {
  const params = parsedUrlOf(url)?.searchParams
  if (params === undefined) return undefined
  const result = resultOf(params.get(RETURN_RESULT_PARAM))
  const state = params.get(RETURN_STATE_PARAM)
  if (result === undefined || state === null || state.length === 0) return undefined
  const reason = params.get(RETURN_REASON_PARAM)
  return {
    state,
    outcome: result === EReturnResult.Failed && reason !== null ? { result, reason } : { result },
  }
}

export const withoutReturnParams = (url: string): string => {
  const parsed = parsedUrlOf(url)
  if (parsed === undefined) return url
  for (const name of RETURN_PARAMS) parsed.searchParams.delete(name)
  return parsed.toString()
}

export const returnOutcomeOf = (args: {
  durable: ReturnOutcome | undefined
  local: ReturnOutcome | undefined
}): ReturnOutcome | undefined => args.durable ?? args.local
