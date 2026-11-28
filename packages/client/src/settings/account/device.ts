import type { IAuthSession } from './auth-api'
import { relativeTime } from './relative-time'

export enum EDeviceKind {
  Browser = 'browser',
  Cli = 'cli',
  Sandbox = 'sandbox',
}

export type ISignedInDevice = {
  id: string
  kind: EDeviceKind
  name: string
  meta: string
  current: boolean
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/curl\//, 'curl'],
]

const PLATFORMS: [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

export const deviceNameOf = (userAgent: string | null | undefined): string => {
  if (!userAgent) return 'Unknown device'
  if (/^atlas/i.test(userAgent)) return userAgent
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1]
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1]
  if (browser === undefined) return userAgent.slice(0, 40)
  return platform === undefined ? browser : `${browser} on ${platform}`
}

export const deviceKindOf = (userAgent: string | null | undefined): EDeviceKind =>
  userAgent && /^atlas|curl\//i.test(userAgent) ? EDeviceKind.Cli : EDeviceKind.Browser

export const toDevice = ({
  session,
  currentToken,
  now,
}: {
  session: IAuthSession
  currentToken: string | null
  now?: number
}): ISignedInDevice => {
  const active = relativeTime({
    from: session.updatedAt ?? session.createdAt,
    ...(now === undefined ? {} : { now }),
  })
  const meta = [session.ipAddress ? session.ipAddress : null, `Last active ${active}`]
    .filter((part) => part !== null)
    .join(', ')
  return {
    id: session.token,
    kind: deviceKindOf(session.userAgent),
    name: deviceNameOf(session.userAgent),
    meta,
    current: session.token === currentToken,
  }
}

export const signedInDevicesOf = ({
  sessions,
  currentToken,
  now,
}: {
  sessions: readonly IAuthSession[]
  currentToken: string | null
  now?: number
}): ISignedInDevice[] =>
  sessions
    .map((session) => toDevice({ session, currentToken, ...(now === undefined ? {} : { now }) }))
    .sort((left, right) => Number(right.current) - Number(left.current))
