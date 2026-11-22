import { latestResourceOf, loadedUnderCloudOf, type V2Event } from '@dltech/atlas-core'
import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'
import type { ECloudSetting, PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'

import { cloudStringOf, messageOf, versionsKnownOf, versionsOf } from './plugin-resource-probes'
import { ELoadReason } from './plugin-resource-reason'
import { refresh, watchOf } from './plugin-resource-refresh'
import { reloadOne } from './plugin-resource-reload'

type Ctx = PluginPodContext

type Versions = Readonly<Record<ECloudSetting, string>>

export type ReconnectWatch = (listener: (hello: { restart: boolean }) => void) => () => void

export type ResourceSyncArgs = {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  directory(): string
  trace: TracePort | undefined
  shared: (() => readonly V2Event[]) | undefined
  reconnect: ReconnectWatch
  signal?: AbortSignal | undefined
}

export class ResourceSync {
  private readonly args: ResourceSyncArgs
  private readonly running = new Map<string, Promise<void>>()
  private readonly queued = new Set<string>()
  private readonly offs: (() => void)[] = []
  private initial: Promise<void> | undefined
  private refreshing: Promise<void> | undefined
  private started = false

  constructor(args: ResourceSyncArgs) {
    this.args = args
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
    this.offs.push(
      this.args.reconnect((hello) => {
        if (!hello.restart) return
        this.refreshInBackground()
      }),
    )
    this.initial = this.refreshStart()
  }

  stop(): void {
    for (const off of this.offs.splice(0)) off()
    this.started = false
  }

  async turnStart(): Promise<void> {
    if (!this.args.resources.every((resource) => this.recordedOf(resource))) {
      await (this.initial ?? this.refreshStart())
      return
    }
    await this.reloadCloudChanged()
  }

  refreshInBackground(): void {
    void this.refreshStart()
  }

  async settled(): Promise<void> {
    for (;;) {
      const running = [...this.running.values()]
      if (this.refreshing !== undefined) running.push(this.refreshing)
      if (running.length === 0) return
      await Promise.all(running.map((attempt) => attempt.catch(() => undefined)))
    }
  }

  private recordedOf(resource: PodResource<unknown>): boolean {
    if (resource.background === true) return true
    const latest = latestResourceOf({ events: this.args.ctx.events(), resource: resource.name })
    if (latest === undefined) return false
    const parsed = resource.schema.safeParse(latest.value)
    return parsed.success && resource.stale?.(parsed.data) !== true
  }

  private async reloadCloudChanged(): Promise<void> {
    const cloud = this.args.resources.filter((resource) => resource.cloud !== undefined)
    if (cloud.length === 0) return
    const versions = await spanWith(this.args.trace, {
      name: ESpan.ResourceVersions,
      run: () => versionsOf({ ctx: this.args.ctx, needed: true }),
    })
    if (!versionsKnownOf(versions)) return
    const directory = this.args.directory()
    await Promise.all(
      cloud
        .filter((resource) => this.cloudChangedOf({ resource, versions, directory }))
        .map((resource) => {
          const reason = ELoadReason.Cloud
          if (resource.background === true) {
            void this.reload({ resource, directory, reason })
            return undefined
          }
          return this.reload({ resource, directory, reason })
        }),
    )
  }

  private cloudChangedOf(args: {
    resource: PodResource<unknown>
    versions: Versions
    directory: string
  }): boolean {
    const latest = latestResourceOf({
      events: this.args.ctx.events(),
      resource: args.resource.name,
    })
    if (latest === undefined) return false
    return !loadedUnderCloudOf({
      fingerprint: latest.fingerprint,
      cloud: cloudStringOf({ settings: args.resource.cloud, versions: args.versions }),
      directory: args.directory,
    })
  }

  private refreshStart(): Promise<void> {
    const running = this.refreshing
    if (running !== undefined) return running
    const attempt = refresh({
      ctx: this.args.ctx,
      resources: this.args.resources,
      projectDirectory: this.args.directory(),
      trace: this.args.trace,
      shared: this.args.shared,
    })
      .catch((failure: unknown) => {
        this.args.ctx.log(`plugin resources could not refresh: ${messageOf(failure)}`)
      })
      .finally(() => {
        this.refreshing = undefined
      })
    this.refreshing = attempt
    return attempt
  }

  private handleChanged(watchId: string): void {
    const directory = this.args.directory()
    for (const resource of this.args.resources) {
      const watch = watchOf({ resource, directory })
      if (watch === undefined || watch.id !== watchId) continue
      if (this.running.has(resource.name)) {
        this.queued.add(resource.name)
        continue
      }
      void this.reload({ resource, directory, reason: ELoadReason.Changed })
    }
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
      if (this.queued.delete(name)) {
        void this.reload({
          resource: args.resource,
          directory: args.directory,
          reason: ELoadReason.Changed,
        })
      }
    })
    this.running.set(name, attempt)
    return attempt
  }

  private async reloadNow(args: {
    resource: PodResource<unknown>
    directory: string
    reason: ELoadReason
  }): Promise<void> {
    const initial = this.initial
    if (initial !== undefined) await initial.catch(() => undefined)
    await reloadOne({
      ctx: this.args.ctx,
      trace: this.args.trace,
      resource: args.resource,
      directory: this.args.directory(),
      reason: args.reason,
    })
  }
}
