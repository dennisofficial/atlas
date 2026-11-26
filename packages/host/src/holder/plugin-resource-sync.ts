import { latestResourceOf, type RecordEvent } from '@dltech/atlas-core'
import { EResourceWait, type TracePort } from '@dltech/atlas-observability'
import type { PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'

import { appendOf, draftsOf } from './plugin-resource-loads'
import { messageOf } from './plugin-resource-probes'
import { ELoadReason } from './plugin-resource-reason'
import { refresh, watchOf, type Adoption } from './plugin-resource-refresh'
import { reloadOne } from './plugin-resource-reload'
import { ResourceTurn } from './plugin-resource-turn'
import { spanWaitOf, type ResourceWait } from './plugin-resource-waits'

type Ctx = PluginPodContext

export type ReconnectWatch = (listener: (hello: { restart: boolean }) => void) => () => void

export type ResourceSyncArgs = {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  directory(): string
  trace: TracePort | undefined
  shared: (() => readonly RecordEvent[]) | undefined
  reconnect: ReconnectWatch
  podReady(): boolean
  signal?: AbortSignal | undefined
}

export class ResourceSync {
  private readonly args: ResourceSyncArgs
  private readonly turn: ResourceTurn
  private readonly running = new Map<string, Promise<void>>()
  private readonly queued = new Set<string>()
  private readonly backgroundLoads = new Map<string, Promise<void>>()
  private readonly refreshLoads = new Map<string, Promise<void>>()
  private readonly adoptions = new Map<string, Promise<void>>()
  private readonly offs: (() => void)[] = []
  private readonly waitOn: ResourceWait
  private initial: Promise<void> | undefined
  private refreshing: Promise<void> | undefined
  private planned: Promise<void> | undefined
  private retryOnReady = false
  private retryQueued = false
  private helloDuringRound = false
  private started = false

  constructor(args: ResourceSyncArgs) {
    this.args = args
    this.waitOn = spanWaitOf(args.trace)
    this.turn = new ResourceTurn({
      ctx: args.ctx,
      resources: args.resources,
      directory: () => this.args.directory(),
      trace: args.trace,
      shared: args.shared,
      podReady: () => this.args.podReady(),
      waitOn: (wait) => this.waitOn(wait),
      initialOf: () => this.initial ?? this.refreshStart(),
      plannedOf: () => (this.refreshing === undefined ? undefined : this.planned),
      refreshLoadOf: (name) => this.refreshLoads.get(name),
      backgroundLoadOf: (name) => this.backgroundLoads.get(name),
      adoptOf: (adoption) => this.adoptOf(adoption),
      reload: (reload) => this.reload(reload),
    })
    args.signal?.addEventListener('abort', () => this.stop(), { once: true })
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.offs.push(
      this.args.ctx.onDaemonEvent((frame) => {
        if (frame.event.type !== 'watch.changed') return
        this.handleChanged(frame.event.watchId)
      }),
    )
    this.offs.push(this.args.reconnect((hello) => this.handleReady(hello)))
    this.initial = this.refreshStart()
  }

  stop(): void {
    for (const off of this.offs.splice(0)) off()
    this.started = false
  }

  turnStart(): Promise<void> {
    return this.turn.start()
  }

  refreshInBackground(): void {
    void this.refreshStart()
  }

  adoptOf(adoption: Adoption): Promise<boolean> {
    const key = `${adoption.resource.name}:${adoption.fingerprint}`
    const running = this.adoptions.get(key)
    if (running !== undefined) return running.then(() => true).catch(() => false)
    const latest = latestResourceOf({
      events: this.args.ctx.events(),
      resource: adoption.resource.name,
    })
    if (latest?.fingerprint === adoption.fingerprint) return Promise.resolve(true)
    const attempt = appendOf({
      ctx: this.args.ctx,
      trace: this.args.trace,
      drafts: draftsOf({
        resource: adoption.resource,
        ctx: this.args.ctx,
        value: adoption.value,
        fingerprint: adoption.fingerprint,
      }),
    }).finally(() => {
      if (this.adoptions.get(key) === attempt) this.adoptions.delete(key)
    })
    this.adoptions.set(key, attempt)
    return attempt.then(() => true).catch(() => false)
  }

  async settled(): Promise<void> {
    for (;;) {
      const running = [...this.running.values()]
      if (this.refreshing !== undefined) running.push(this.refreshing)
      if (running.length === 0) return
      await this.waitOn({
        waitFor: EResourceWait.Settle,
        work: () => Promise.all(running.map((attempt) => attempt.catch(() => undefined))),
      })
    }
  }

  private handleReady(hello: { restart: boolean }): void {
    if (this.refreshing !== undefined) {
      this.helloDuringRound = true
      if (hello.restart) this.retryQueued = true
      return
    }
    if (!hello.restart && !this.retryOnReady) return
    this.retryOnReady = false
    this.refreshInBackground()
  }

  private retryRound(): void {
    const hello = this.helloDuringRound
    const restarted = this.retryQueued
    this.helloDuringRound = false
    this.retryQueued = false
    if (!restarted && !(hello && this.retryOnReady)) return
    this.retryOnReady = false
    this.refreshInBackground()
  }

  private refreshStart(): Promise<void> {
    const running = this.refreshing
    if (running !== undefined) return running
    let planned: () => void = () => undefined
    const decided = new Promise<void>((resolve) => {
      planned = resolve
    })
    this.planned = decided
    const attempt = refresh({
      ctx: this.args.ctx,
      resources: this.args.resources,
      projectDirectory: this.args.directory(),
      trace: this.args.trace,
      shared: this.args.shared,
      adopt: (adoption) => this.adoptOf(adoption),
      loadingOf: (resource) => this.backgroundLoads.has(resource),
      onBackground: (background) => this.trackBackground(background),
      onLoad: (load) => this.trackRefreshLoad(load),
      onPlanned: planned,
      onUnreached: () => {
        this.retryOnReady = true
      },
    })
      .catch((failure: unknown) => {
        this.args.ctx.log(`plugin resources could not refresh: ${messageOf(failure)}`)
      })
      .finally(() => {
        planned()
        this.refreshing = undefined
        this.retryRound()
      })
    this.refreshing = attempt
    return attempt
  }

  private trackBackground(args: { resource: string; loading: Promise<void> }): void {
    const tracked = args.loading.finally(() => {
      if (this.backgroundLoads.get(args.resource) !== tracked) return
      this.backgroundLoads.delete(args.resource)
      this.reloadQueued(args.resource)
    })
    this.backgroundLoads.set(args.resource, tracked)
  }

  private trackRefreshLoad(args: { resource: string; loading: Promise<void> }): void {
    const tracked = args.loading
      .catch(() => undefined)
      .finally(() => {
        if (this.refreshLoads.get(args.resource) !== tracked) return
        this.refreshLoads.delete(args.resource)
      })
    this.refreshLoads.set(args.resource, tracked)
  }

  private busyOf(name: string): boolean {
    return this.running.has(name) || this.backgroundLoads.has(name)
  }

  private handleChanged(watchId: string): void {
    const directory = this.args.directory()
    for (const resource of this.args.resources) {
      const watch = watchOf({ resource, directory })
      if (watch === undefined || watch.id !== watchId) continue
      if (this.busyOf(resource.name)) {
        this.queued.add(resource.name)
        continue
      }
      void this.reload({ resource, directory, reason: ELoadReason.Changed })
    }
  }

  private reloadQueued(name: string): void {
    if (!this.queued.delete(name)) return
    if (this.running.has(name)) {
      this.queued.add(name)
      return
    }
    const resource = this.args.resources.find((each) => each.name === name)
    if (resource === undefined) return
    void this.reload({ resource, directory: this.args.directory(), reason: ELoadReason.Changed })
  }

  private reload(args: {
    resource: PodResource<unknown>
    directory: string
    reason: ELoadReason
  }): Promise<void> {
    const name = args.resource.name
    const running = this.running.get(name)
    if (running !== undefined) return running
    const attempt = this.reloadNow(args).finally(() => {
      this.running.delete(name)
      this.reloadQueued(name)
    })
    this.running.set(name, attempt)
    return attempt
  }

  private async reloadNow(args: {
    resource: PodResource<unknown>
    directory: string
    reason: ELoadReason
  }): Promise<void> {
    const planned = this.refreshing === undefined ? undefined : this.planned
    const refreshed = this.refreshLoads.get(args.resource.name)
    if (planned !== undefined) await planned.catch(() => undefined)
    if (refreshed !== undefined) await refreshed.catch(() => undefined)
    const background = this.backgroundLoads.get(args.resource.name)
    if (background !== undefined) await background.catch(() => undefined)
    await reloadOne({
      ctx: this.args.ctx,
      trace: this.args.trace,
      resource: args.resource,
      directory: this.args.directory(),
      reason: args.reason,
      onUnreached: () => {
        this.retryOnReady = true
      },
    })
  }
}
