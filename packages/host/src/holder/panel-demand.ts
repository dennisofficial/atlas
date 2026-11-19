export type PanelDemandObservers = {
  onWork(sessionId: string): void
  onIdle(sessionId: string): void
}

export const PANEL_HOLD_TTL_MS = 60_000

type Armed = { timer: ReturnType<typeof setTimeout>; expiresAt: number }

export class PanelDemand {
  private readonly armed = new Map<string, Armed>()
  private observers: PanelDemandObservers = {
    onWork: () => undefined,
    onIdle: () => undefined,
  }

  constructor(private readonly now: () => number = () => Date.now()) {}

  observe(observers: PanelDemandObservers): void {
    this.observers = observers
  }

  holds(sessionId: string): boolean {
    const entry = this.armed.get(sessionId)
    return entry !== undefined && entry.expiresAt > this.now()
  }

  countOf(sessionId: string): number {
    return this.holds(sessionId) ? 1 : 0
  }

  hold(args: { sessionId: string; ttlMs?: number | undefined }): void {
    const ttlMs = args.ttlMs ?? PANEL_HOLD_TTL_MS
    const existing = this.armed.get(args.sessionId)
    if (existing !== undefined) clearTimeout(existing.timer)
    const timer = setTimeout(() => this.expire(args.sessionId), ttlMs)
    timer.unref?.()
    this.armed.set(args.sessionId, { timer, expiresAt: this.now() + ttlMs })
    if (existing === undefined) this.observers.onWork(args.sessionId)
  }

  release(sessionId: string): boolean {
    if (!this.armed.has(sessionId)) return false
    this.expire(sessionId)
    return true
  }

  stop(): void {
    for (const entry of this.armed.values()) clearTimeout(entry.timer)
    this.armed.clear()
  }

  private expire(sessionId: string): void {
    const entry = this.armed.get(sessionId)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    this.armed.delete(sessionId)
    this.observers.onIdle(sessionId)
  }
}
