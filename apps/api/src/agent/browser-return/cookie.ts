import { returnPortOf, returnSurfaceOf, type ReturnCookie } from '@dltech/atlas-core'
import { z } from 'zod'

import { sealJson, unsealJson, type JsonCipher } from './seal'

export const BROWSER_RETURN_COOKIE = 'atlas_return'

const MAX_AGE_SECONDS = 600

const cookieBodySchema = z.object({
  state: z.string(),
  surface: z.string(),
  port: z.number().int().optional(),
})

const attributesOf = (path: string): string => `Path=${path}; HttpOnly; Secure; SameSite=Lax`

export const returnCookieOf = (args: {
  cipher: JsonCipher
  cookie: ReturnCookie
  path: string
}): string => {
  const body =
    args.cookie.port === undefined
      ? { state: args.cookie.state, surface: args.cookie.surface }
      : { state: args.cookie.state, surface: args.cookie.surface, port: args.cookie.port }
  const sealed = sealJson({ cipher: args.cipher, value: body })
  return `${BROWSER_RETURN_COOKIE}=${encodeURIComponent(sealed)}; Max-Age=${MAX_AGE_SECONDS}; ${attributesOf(args.path)}`
}

export const clearedReturnCookie = (args: { path: string }): string =>
  `${BROWSER_RETURN_COOKIE}=; Max-Age=0; ${attributesOf(args.path)}`

const rawCookieIn = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined
  const prefix = `${BROWSER_RETURN_COOKIE}=`
  const pair = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return pair === undefined ? undefined : pair.slice(prefix.length)
}

export const returnCookieIn = (args: {
  cipher: JsonCipher
  header: string | undefined
}): ReturnCookie | undefined => {
  const raw = rawCookieIn(args.header)
  if (raw === undefined || raw.length === 0) return undefined
  try {
    const body = unsealJson({
      cipher: args.cipher,
      sealed: decodeURIComponent(raw),
      schema: cookieBodySchema,
    })
    const surface = returnSurfaceOf(body.surface)
    if (surface === undefined) return undefined
    return { state: body.state, surface, port: returnPortOf(body.port) }
  } catch {
    return undefined
  }
}
