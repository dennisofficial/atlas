import { signInSurfaceOf, type SignInSurfaceCookie } from '@dltech/atlas-plugin-mcp/core'
import { z } from 'zod'

import { MCP_OAUTH_CALLBACK_PATH } from './callback-path'
import { sealJson, unsealJson, type JsonCipher } from './seal'

export const MCP_SIGN_IN_COOKIE = 'atlas_mcp_sign_in'

const MAX_AGE_SECONDS = 600

const ATTRIBUTES = `Path=${MCP_OAUTH_CALLBACK_PATH}; HttpOnly; Secure; SameSite=Lax`

const cookieBodySchema = z.object({ state: z.string(), surface: z.string() })

export const surfaceCookieOf = (args: {
  cipher: JsonCipher
  cookie: SignInSurfaceCookie
}): string =>
  `${MCP_SIGN_IN_COOKIE}=${encodeURIComponent(sealJson({ cipher: args.cipher, value: args.cookie }))}; Max-Age=${MAX_AGE_SECONDS}; ${ATTRIBUTES}`

export const CLEARED_SURFACE_COOKIE = `${MCP_SIGN_IN_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`

const rawCookieIn = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined
  const prefix = `${MCP_SIGN_IN_COOKIE}=`
  const pair = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return pair === undefined ? undefined : pair.slice(prefix.length)
}

export const surfaceCookieIn = (args: {
  cipher: JsonCipher
  header: string | undefined
}): SignInSurfaceCookie | undefined => {
  const raw = rawCookieIn(args.header)
  if (raw === undefined || raw.length === 0) return undefined
  try {
    const body = unsealJson({
      cipher: args.cipher,
      sealed: decodeURIComponent(raw),
      schema: cookieBodySchema,
    })
    const surface = signInSurfaceOf(body.surface)
    return surface === undefined ? undefined : { state: body.state, surface }
  } catch {
    return undefined
  }
}
