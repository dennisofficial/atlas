import type { BackgroundWork } from '../../../_core/ports/background-work'
import type { SandboxResourcesObservation } from '../../platform/sandboxes/vercel-sandbox.client'

const FRESH_MS = 60_000
const FAILED_MS = 15_000
const MAX_ENTRIES = 500

type Read = () => Promise<SandboxResourcesObservation>

interface Entry {
  live: SandboxResourcesObservation | null
  readAt: number
}

export class PodResourcesCache {
  private readonly entries = new Map<string, Entry>()
  private readonly inflight = new Map<string, Promise<SandboxResourcesObservation | null>>()

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
  }

  private refresh(args: { key: string; read: Read }): Promise<SandboxResourcesObservation | null> {
    const { key, read } = args
    const running = this.inflight.get(key)
    if (running !== undefined) return running
    const started = read()
      .then((live): SandboxResourcesObservation | null => {
        this.store({ key, live })
        return live
      })
      .catch((failure: unknown) => {
        this.onFailure({ key, failure })
        const previous = this.entries.get(key)?.live ?? null
        this.store({ key, live: previous })
        return previous
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, started)
    return started
  }

  private store(args: { key: string; live: SandboxResourcesObservation | null }): void {
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear()
    this.entries.set(args.key, { live: args.live, readAt: Date.now() })
  }
}
