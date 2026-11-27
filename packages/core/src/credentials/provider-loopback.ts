import { parsedUrlOf } from '../browser-return/links'

export const OPENAI_LOOPBACK_PORTS: readonly number[] = [1455, 1457]
export const OPENAI_LOOPBACK_PATH = '/auth/callback'
export const ANTHROPIC_LOOPBACK_PATH = '/callback'
export const ANTHROPIC_LOOPBACK_PORT_MIN = 1024
export const PROVIDER_LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost']

export const openaiLoopbackRedirectUriOf = (port: number): string =>
  `http://127.0.0.1:${port}${OPENAI_LOOPBACK_PATH}`

export const anthropicLoopbackRedirectUriOf = (port: number): string =>
  `http://localhost:${port}${ANTHROPIC_LOOPBACK_PATH}`

const bareLoopbackUrlOf = (redirectUri: string): URL | undefined => {
  const parsed = parsedUrlOf(redirectUri)
  if (parsed === undefined) return undefined
  if (parsed.protocol !== 'http:') return undefined
  if (parsed.username !== '' || parsed.password !== '') return undefined
  if (parsed.search !== '' || parsed.hash !== '') return undefined
  return parsed
}

const portOf = (url: URL): number | undefined => {
  const port = Number(url.port)
  return Number.isInteger(port) && port > 0 ? port : undefined
}

export const openaiLoopbackRedirectOk = (redirectUri: string): boolean => {
  const url = bareLoopbackUrlOf(redirectUri)
  if (url === undefined) return false
  const port = portOf(url)
  return (
    url.hostname === '127.0.0.1' &&
    url.pathname === OPENAI_LOOPBACK_PATH &&
    port !== undefined &&
    OPENAI_LOOPBACK_PORTS.includes(port)
  )
}

export const anthropicLoopbackRedirectOk = (redirectUri: string): boolean => {
  const url = bareLoopbackUrlOf(redirectUri)
  if (url === undefined) return false
  const port = portOf(url)
  return (
    url.hostname === 'localhost' &&
    url.pathname === ANTHROPIC_LOOPBACK_PATH &&
    port !== undefined &&
    port >= ANTHROPIC_LOOPBACK_PORT_MIN &&
    port <= 65535
  )
}
