import type { Db } from '@dltech/atlas-db'
import { EMcpSignInSurface, signInSurfaceOf } from '@dltech/atlas-plugin-mcp/core'

import { PendingSurfaceStore } from './pending-surface'
import { sealedPendingSchema } from './types'
import { surfaceCookieOf } from './sign-in-cookie'
import { unsealJson, type JsonCipher } from './seal'

export type StartAnswer =
  | { kind: 'redirect'; location: string; cookie: string }
  | { kind: 'gone'; html: string }

export type StartHandler = (request: {
  state: string
  surface: string | null | undefined
}) => Promise<StartAnswer>

const GONE: StartAnswer = {
  kind: 'gone',
  html: [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Sign-in link expired</title></head>',
    '<body style="margin:0;padding:2.5rem;font:16px/1.5 system-ui,sans-serif;color:#1c1c1c">',
    '<p>This sign-in link expired or was already used. Ask Atlas to start the sign-in again.</p>',
    '</body></html>',
  ].join(''),
}

const authorizationUrlOf = (args: { cipher: JsonCipher; sealed: string }): string | undefined => {
  try {
    return unsealJson({ cipher: args.cipher, sealed: args.sealed, schema: sealedPendingSchema })
      .authorizationUrl
  } catch {
    return undefined
  }
}

export const mcpOauthStartOf = (args: {
  db: Db
  cipher: JsonCipher
  now?: (() => number) | undefined
}): StartHandler => {
  const store = new PendingSurfaceStore(args.db)
  const now = args.now ?? Date.now
  return async (request) => {
    const pending = await store.findOpen({ id: request.state })
    if (pending === null || pending.expiresAt.getTime() < now()) return GONE
    const location = authorizationUrlOf({ cipher: args.cipher, sealed: pending.sealed })
    if (location === undefined) return GONE
    const surface = signInSurfaceOf(request.surface) ?? EMcpSignInSurface.Web
    await store.record({ id: pending.id, surface })
    return {
      kind: 'redirect',
      location,
      cookie: surfaceCookieOf({ cipher: args.cipher, cookie: { state: pending.id, surface } }),
    }
  }
}
