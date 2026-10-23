import {
  EAuthKind,
  type CredentialPort,
  type EAuthProvider,
  type ModelCard,
  type OauthCredential,
} from '@dltech/atlas-core'

import { parseCacheEntry, type CacheEntry } from './codex-cache-entry'
import { hasListedModel, ModelsResponseSchema, toCodexModelCards } from './codex-models-response'
import type { CodexModelsPorts } from './codex-ports'

// openai/codex codex-rs/core/src/models_manager (manager.rs, cache.rs): the picker is fetched from
// GET /models?client_version=<X.Y.Z>, cached in $CODEX_HOME/models_cache.json for 300s, revalidated
// with the response ETag via If-None-Match, and the remote list replaces the bundled one for
// ChatGPT accounts whenever it carries at least one `visibility: "list"` model.
const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'
const CODEX_ORIGINATOR = 'codex_cli_rs'
export const CODEX_MODELS_TTL_MS = 300_000

const sameCards = (a: readonly ModelCard[], b: readonly ModelCard[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

const isPromise = <T>(value: T | Promise<T>): value is Promise<T> =>
  typeof value === 'object' && value !== null && 'then' in value

export class CodexModelsCatalogue {
  private readonly credentials: CredentialPort
  private readonly provider: EAuthProvider
  private readonly clientVersion: string
  private readonly ports: CodexModelsPorts
  private readonly ttlMs: number

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
    ports: CodexModelsPorts
    ttlMs?: number
  }) {
    this.credentials = args.credentials
    this.provider = args.provider
    this.clientVersion = args.clientVersion
    this.ports = args.ports
    this.ttlMs = args.ttlMs ?? CODEX_MODELS_TTL_MS
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
    const identity = await this.ports.identityOf(credential)
    const entry = this.held ?? (await this.readEntry())
    const sameAccount = entry?.identity === identity

    if (entry !== undefined && !sameAccount) this.adopt(undefined)
    if (entry !== undefined && sameAccount && this.isFresh(entry)) {
      this.adopt(entry)
      return
    }

    const response = await this.ports.fetch(this.modelsUrl(), {
      headers: this.headersFor({ credential, etag: sameAccount ? entry?.etag : undefined }),
    })

    if (response.status === 304 && entry !== undefined && sameAccount) {
      await this.store({ ...entry, fetchedAt: this.ports.now() })
      return
    }
    if (!response.ok) throw new Error(`codex models request failed: ${response.status}`)

    const parsed = ModelsResponseSchema.parse(await response.json())
    if (!hasListedModel(parsed.models)) return

    const etag = response.headers.get('etag') ?? undefined
    await this.store({
      identity,
      fetchedAt: this.ports.now(),
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
    const age = Date.parse(this.ports.now()) - Date.parse(entry.fetchedAt)
    return Number.isFinite(age) && age >= 0 && age < this.ttlMs
  }

  private loadEntry(): CacheEntry | undefined {
    try {
      const text = this.ports.cache.read()
      return isPromise(text) ? undefined : parseCacheEntry(text)
    } catch {
      return undefined
    }
  }

  private async readEntry(): Promise<CacheEntry | undefined> {
    try {
      const entry = parseCacheEntry(await this.ports.cache.read())
      this.seed(entry)
      return entry
    } catch {
      return undefined
    }
  }

  private seed(entry: CacheEntry | undefined): void {
    if (this.seeded?.entry !== undefined || entry === undefined) return
    const before = this.cards() ?? []
    this.seeded = { entry }
    if (sameCards(before, this.cards() ?? [])) return
    this.announce()
  }

  private async persist(entry: CacheEntry): Promise<void> {
    try {
      await this.ports.cache.write(JSON.stringify(entry))
    } catch (fault) {
      this.failure = fault instanceof Error ? fault.message : String(fault)
    }
  }

  private async store(entry: CacheEntry): Promise<void> {
    this.adopt(entry)
    await this.persist(entry)
  }

  private adopt(entry: CacheEntry | undefined): void {
    const before = this.cards() ?? []
    this.held = entry ?? { identity: '', fetchedAt: '', cards: [] }
    const after = this.cards() ?? []
    if (sameCards(before, after)) return

    this.announce()
  }

  private announce(): void {
    this.bumps += 1
    for (const listener of this.listeners) listener()
  }
}
