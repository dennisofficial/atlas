import type { BackgroundWork } from '../../../_core/ports/background-work'
import type { SandboxResourcesObservation } from './vercel-sandbox.client'

const FRESH_MS = 60_000
const FAILED_MS = 15_000
const MAX_ENTRIES = 500

type Read = () => Promise<SandboxResourcesObservation | null>

interface Entry {
  live: SandboxResourcesObservation | null
  readAt: number
}

interface Inflight {
  generation: number
  promise: Promise<SandboxResourcesObservation | null>
}

export class PodResourcesCache {
  private readonly entries = new Map<string, Entry>()
  private readonly inflight = new Map<string, Inflight>()
  private readonly generations = new Map<string, number>()

  constructor(
    private readonly background: BackgroundWork,
    private readonly onFailure: (args: { key: string; failure: unknown }) => void,
  ) {}

  async resolve(args: { key: string; read: Read }): Promise<SandboxResourcesObservation | null> {
    const { key, read } = args
    const entry = this.entries.get(key)
    if (entry === undefined) return this.refresh({ key, read })
    const ttl = entry.live === null ? FAILED_MS : FRESH_MS
    if (Date.now() - entry.readAt >= ttl) {
      this.background.keepAlive(this.refresh({ key, read }))
    }
    return entry.live
  }

  forget(key: string): void {
    this.entries.delete(key)
    this.generations.set(key, this.generationOf(key) + 1)
  }

  private refresh(args: { key: string; read: Read }): Promise<SandboxResourcesObservation | null> {
    const { key, read } = args
    const generation = this.generationOf(key)
    const running = this.inflight.get(key)
    if (running !== undefined && running.generation === generation) return running.promise
    const promise = read()
      .then((live): SandboxResourcesObservation | null => {
        this.store({ key, generation, live })
        return live
      })
      .catch((failure: unknown) => {
        this.onFailure({ key, failure })
        const previous = this.entries.get(key)?.live ?? null
        this.store({ key, generation, live: previous })
        return previous
      })
      .finally(() => {
        if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key)
      })
    this.inflight.set(key, { generation, promise })
    return promise
  }

  private store(args: {
    key: string
    generation: number
    live: SandboxResourcesObservation | null
  }): void {
    if (args.generation !== this.generationOf(args.key)) return
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear()
    this.entries.set(args.key, { live: args.live, readAt: Date.now() })
  }

  private generationOf(key: string): number {
    return this.generations.get(key) ?? 0
  }
}
