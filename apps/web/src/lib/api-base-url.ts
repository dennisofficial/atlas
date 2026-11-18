import { isDesktopHost } from '../features/desktop/desktop-attributes'
import { resolveApiOrigin } from './api-origin'

export function apiBaseUrlOf(args: {
  host: object | null
  env: Record<string, string | undefined>
}): string {
  if (args.host === null || isDesktopHost(args.host)) return ''
  return resolveApiOrigin(args.env)
}

const browserHost = (): object | null => (typeof window === 'undefined' ? null : window)

const buildEnv = { ATLAS_API_ORIGIN: process.env.ATLAS_API_ORIGIN }

export const apiBaseUrl = (): string => apiBaseUrlOf({ host: browserHost(), env: buildEnv })

export const apiUrl = (path: string): string => `${apiBaseUrl()}${path}`
