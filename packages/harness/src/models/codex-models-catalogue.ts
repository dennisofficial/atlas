import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  EAuthKind,
  EEffort,
  EImageTier,
  type CredentialPort,
  type EAuthProvider,
  type ModelCard,
  type OauthCredential,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { atlasDirectory } from '../store/paths'
import {
  hasListedModel,
  ModelsResponseSchema,
  toCodexModelCards,
} from './codex-models-response'

// openai/codex codex-rs/core/src/models_manager (manager.rs, cache.rs): the picker is fetched from
// GET /models?client_version=<X.Y.Z>, cached in $CODEX_HOME/models_cache.json for 300s, revalidated
// with the response ETag via If-None-Match, and the remote list replaces the bundled one for
// ChatGPT accounts whenever it carries at least one `visibility: "list"` model.
const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'
const CODEX_ORIGINATOR = 'codex_cli_rs'
const CACHE_FILE_NAME = 'codex-models-cache.json'
export const CODEX_MODELS_TTL_MS = 300_000

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const CachedCardSchema = z.object({
  ref: z.object({ providerId: z.string(), modelId: z.string() }),
  label: z.string(),
  api: z.string(),
  contextWindow: z.number(),
  imageTier: z.enum(EImageTier),
  effort: z.partialRecord(z.enum(EEffort), z.union([z.string(), z.number()])).optional(),
})

const CacheEntrySchema = z.object({
  identity: z.string(),
  fetchedAt: z.string(),
  etag: z.string().optional(),
  cards: z.array(CachedCardSchema),
})

type CacheEntry = { identity: string; fetchedAt: string; etag?: string; cards: ModelCard[] }

const toCacheEntry = (raw: z.infer<typeof CacheEntrySchema>): CacheEntry => ({
  identity: raw.identity,
  fetchedAt: raw.fetchedAt,
  ...(raw.etag === undefined ? {} : { etag: raw.etag }),
  cards: raw.cards.map(({ effort, ...card }) => ({
    ...card,
    ...(effort === undefined ? {} : { effort }),
  })),
})

export const codexCacheIdentity = (credential: OauthCredential): string =>
  createHash('sha256')
    .update(credential.providerAccountId ?? credential.accountId)
    .digest('hex')

const sameCards = (a: readonly ModelCard[], b: readonly ModelCard[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export class CodexModelsCatalogue {
  private readonly credentials: CredentialPort
  private readonly provider: EAuthProvider
  private readonly clientVersion: string
  private readonly fetchImpl: FetchLike
  private readonly cacheFile: string
  private readonly ttlMs: number
  private readonly now: () => string

  private held: CacheEntry | undefined
  private seeded: { entry: CacheEntry | undefined } | undefined
  private inflight: Promise<void> | undefined
  private failure: string | undefined
  private bumps = 0
  private readonly listeners = new Set<() => void>()

  constructor(args: {
    credentials: CredentialPort
    provider: EAuthProvider
    clientVersion: string
    fetch?: FetchLike
    cacheFile?: string
    ttlMs?: number
    now?: () => string
  }) {
    this.credentials = args.credentials
    this.provider = args.provider
    this.clientVersion = args.clientVersion
    this.fetchImpl = args.fetch ?? ((url, init) => fetch(url, init))
    this.cacheFile = args.cacheFile ?? join(atlasDirectory(), CACHE_FILE_NAME)
    this.ttlMs = args.ttlMs ?? CODEX_MODELS_TTL_MS
    this.now = args.now ?? (() => new Date().toISOString())
  }

  readCached(): ModelCard[] | undefined {
    const entry = this.loadEntry()
    if (entry === undefined || !this.isFresh(entry)) return undefined
    return entry.cards.length === 0 ? undefined : entry.cards
  }

  cards(): readonly ModelCard[] | undefined {
    this.seeded ??= { entry: this.loadEntry() }
    const cards = (this.held ?? this.seeded.entry)?.cards
    return cards === undefined || cards.length === 0 ? undefined : cards
  }

  lastError(): string | undefined {
    return this.failure
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  version(): number {
    return this.bumps
  }

  refresh(): Promise<void> {
    this.inflight ??= this.revalidate().finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  private async revalidate(): Promise<void> {
    try {
      const credential = await this.credentials.read({ provider: this.provider })
      if (credential.kind !== EAuthKind.Oauth) return
      await this.revalidateFor(credential)
      this.failure = undefined
    } catch (fault) {
      this.failure = fault instanceof Error ? fault.message : String(fault)
    }
  }

  private async revalidateFor(credential: OauthCredential): Promise<void> {
    const identity = codexCacheIdentity(credential)
    const entry = this.held ?? this.loadEntry()
    const sameAccount = entry?.identity === identity

    if (entry !== undefined && !sameAccount) this.adopt(undefined)
    if (entry !== undefined && sameAccount && this.isFresh(entry)) {
      this.adopt(entry)
      return
    }

    const response = await this.fetchImpl(this.modelsUrl(), {
      headers: this.headersFor({ credential, etag: sameAccount ? entry?.etag : undefined }),
    })

    if (response.status === 304 && entry !== undefined && sameAccount) {
      this.store({ ...entry, fetchedAt: this.now() })
      return
    }
    if (!response.ok) throw new Error(`codex models request failed: ${response.status}`)

    const parsed = ModelsResponseSchema.parse(await response.json())
    if (!hasListedModel(parsed.models)) return

    const etag = response.headers.get('etag') ?? undefined
    this.store({
      identity,
      fetchedAt: this.now(),
      ...(etag === undefined ? {} : { etag }),
      cards: toCodexModelCards({ models: parsed.models, providerId: this.provider }),
    })
  }

  private modelsUrl(): string {
    return `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(this.clientVersion)}`
  }

  private headersFor(args: {
    credential: OauthCredential
    etag: string | undefined
  }): Record<string, string> {
    return {
      Authorization: `Bearer ${args.credential.accessToken}`,
      ...(args.credential.providerAccountId === undefined
        ? {}
        : { 'ChatGPT-Account-ID': args.credential.providerAccountId }),
      originator: CODEX_ORIGINATOR,
      ...(args.etag === undefined ? {} : { 'If-None-Match': args.etag }),
    }
  }

  private isFresh(entry: CacheEntry): boolean {
    const age = Date.parse(this.now()) - Date.parse(entry.fetchedAt)
    return Number.isFinite(age) && age >= 0 && age < this.ttlMs
  }

  private loadEntry(): CacheEntry | undefined {
    try {
      const parsed = CacheEntrySchema.safeParse(JSON.parse(readFileSync(this.cacheFile, 'utf8')))
      return parsed.success ? toCacheEntry(parsed.data) : undefined
    } catch {
      return undefined
    }
  }

  private persist(entry: CacheEntry): void {
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true })
      const staging = `${this.cacheFile}.${process.pid}.tmp`
      writeFileSync(staging, JSON.stringify(entry))
      renameSync(staging, this.cacheFile)
    } catch (fault) {
      this.failure = fault instanceof Error ? fault.message : String(fault)
    }
  }

  private store(entry: CacheEntry): void {
    this.adopt(entry)
    this.persist(entry)
  }

  private adopt(entry: CacheEntry | undefined): void {
    const before = this.cards() ?? []
    this.held = entry ?? { identity: '', fetchedAt: '', cards: [] }
    const after = this.cards() ?? []
    if (sameCards(before, after)) return

    this.bumps += 1
    for (const listener of this.listeners) listener()
  }
}
