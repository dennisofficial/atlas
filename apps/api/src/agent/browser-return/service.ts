import {
  EReturnSurface,
  returnLinkOf,
  returnPortOf,
  returnSurfaceOf,
  returnTargetOf,
  startLinkOf,
  usableTargetOf,
  type ReturnOutcome,
} from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'
import { z } from 'zod'

import { clearedReturnCookie, returnCookieIn, returnCookieOf } from './cookie'
import { continuePageOf, gonePageOf } from './pages'
import { sealJson, unsealJson, type JsonCipher } from './seal'
import { BrowserReturnStore, recordedTargetOf } from './store'

export type BrowserReturnServiceArgs = {
  db: Db
  cipher: JsonCipher
  publicUrl: string
  webOrigin: string
  now?: (() => Date) | undefined
}

export type BrowserReturnBeginRequest = {
  flow: string
  state: string
  userId?: string | undefined
  providerUrl: string
  callbackPath: string
  webPath: string
  ttlMs?: number | undefined
}

export type BrowserReturnBeginAnswer = { startUrl: string; expiresAt: Date }

export type BrowserReturnStartRequest = {
  state: string
  surface?: string | null | undefined
  port?: string | number | null | undefined
}

export type BrowserReturnStartAnswer =
  | { kind: 'redirect'; location: string; cookie: string }
  | { kind: 'gone'; html: string }

export type BrowserReturnAnswerRequest = {
  state: string
  cookieHeader: string | undefined
  outcome: ReturnOutcome
  fallbackWebPath: string
}

export type BrowserReturnCallbackAnswer =
  | { kind: 'redirect'; location: string; clearCookie: string }
  | { kind: 'page'; html: string; clearCookie: string }

const DEFAULT_TTL_MS = 10 * 60_000

const UNKNOWN_PAGE_PATH = '/'

const pendingSchema = z.object({ providerUrl: z.string() })

const providerUrlOf = (args: { cipher: JsonCipher; sealed: string }): string | undefined => {
  try {
    return unsealJson({ cipher: args.cipher, sealed: args.sealed, schema: pendingSchema })
      .providerUrl
  } catch {
    return undefined
  }
}

export class BrowserReturnService {
  private readonly store: BrowserReturnStore
  private readonly now: () => Date

  constructor(private readonly args: BrowserReturnServiceArgs) {
    this.store = new BrowserReturnStore(args.db)
    this.now = args.now ?? (() => new Date())
  }

  async begin(request: BrowserReturnBeginRequest): Promise<BrowserReturnBeginAnswer> {
    const expiresAt = new Date(this.now().getTime() + (request.ttlMs ?? DEFAULT_TTL_MS))
    await this.store.insert({
      state: request.state,
      flow: request.flow,
      userId: request.userId ?? null,
      surface: EReturnSurface.Web,
      port: null,
      providerUrlSealed: sealJson({
        cipher: this.args.cipher,
        value: { providerUrl: request.providerUrl },
      }),
      callbackPath: request.callbackPath,
      webPath: request.webPath,
      expiresAt,
    })
    return {
      startUrl: startLinkOf({ origin: this.args.publicUrl, state: request.state }),
      expiresAt,
    }
  }

  async pendingUserOf(args: { state: string; flow: string }): Promise<string | undefined> {
    const row = await this.store.findOpen({ state: args.state, now: this.now() })
    if (row === null || row.flow !== args.flow) return undefined
    return row.userId ?? undefined
  }

  async start(request: BrowserReturnStartRequest): Promise<BrowserReturnStartAnswer> {
    const row = await this.store.findOpen({ state: request.state, now: this.now() })
    if (row === null) return { kind: 'gone', html: gonePageOf() }
    const providerUrl = providerUrlOf({
      cipher: this.args.cipher,
      sealed: row.providerUrlSealed,
    })
    if (providerUrl === undefined) return { kind: 'gone', html: gonePageOf() }
    const target = usableTargetOf({
      surface: returnSurfaceOf(request.surface) ?? EReturnSurface.Web,
      port: returnPortOf(request.port),
    })
    await this.store.recordTarget({ state: row.state, target })
    return {
      kind: 'redirect',
      location: providerUrl,
      cookie: returnCookieOf({
        cipher: this.args.cipher,
        cookie: { state: row.state, ...target },
        path: row.callbackPath,
      }),
    }
  }

  async answer(request: BrowserReturnAnswerRequest): Promise<BrowserReturnCallbackAnswer> {
    const row = await this.store.take({ state: request.state, now: this.now() })
    const target = returnTargetOf({
      state: request.state,
      cookie: returnCookieIn({ cipher: this.args.cipher, header: request.cookieHeader }),
      recorded: recordedTargetOf(row),
    })
    const link = returnLinkOf({
      target,
      webOrigin: this.args.webOrigin,
      path: row?.webPath ?? request.fallbackWebPath,
      state: request.state,
      outcome: request.outcome,
    })
    const clearCookie = clearedReturnCookie({ path: row?.callbackPath ?? UNKNOWN_PAGE_PATH })
    if (link.kind === 'redirect') return { kind: 'redirect', location: link.url, clearCookie }
    return {
      kind: 'page',
      html: continuePageOf({
        deepLink: link.url,
        webUrl: link.webUrl,
        outcome: request.outcome,
      }),
      clearCookie,
    }
  }
}
