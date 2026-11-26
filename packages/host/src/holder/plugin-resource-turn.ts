import { latestResourceOf, loadedUnderCloudOf, type RecordEvent } from '@dltech/atlas-core'
import { EResourceWait, ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'
import type { ECloudSetting, PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'

import type { Adoption } from './plugin-resource-refresh'
import { cloudStringOf, versionsKnownOf, versionsOf } from './plugin-resource-probes'
import { ELoadReason } from './plugin-resource-reason'
import type { ResourceWait } from './plugin-resource-waits'

type Ctx = PluginPodContext

type Versions = Readonly<Record<ECloudSetting, string>>

const recordedOf = (args: {
  events: readonly RecordEvent[]
  resource: PodResource<unknown>
}): boolean => {
  if (args.resource.background === true) return true
  const latest = latestResourceOf({ events: args.events, resource: args.resource.name })
  if (latest === undefined) return false
  const parsed = args.resource.schema.safeParse(latest.value)
  return parsed.success && args.resource.stale?.(parsed.data) !== true
}

export type ResourceTurnArgs = {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  directory(): string
  trace: TracePort | undefined
  shared: (() => readonly RecordEvent[]) | undefined
  podReady(): boolean
  waitOn: ResourceWait
  initialOf(): Promise<void> | undefined
  plannedOf(): Promise<void> | undefined
  refreshLoadOf(name: string): Promise<void> | undefined
  backgroundLoadOf(name: string): Promise<void> | undefined
  adoptOf(adoption: Adoption): Promise<boolean>
  reload(args: {
    resource: PodResource<unknown>
    directory: string
    reason: ELoadReason
  }): Promise<void>
}

export class ResourceTurn {
  private readonly args: ResourceTurnArgs

  constructor(args: ResourceTurnArgs) {
    this.args = args
  }

  async start(): Promise<void> {
    const versions = await this.versionsForTurn()
    const waiting = await this.adoptMissing({ versions })
    if (waiting.length > 0) {
      await this.args.waitOn({
        waitFor: EResourceWait.InitialRefresh,
        work: async () => {
          await this.args.initialOf()
        },
      })
      return
    }
    await this.reloadCloudChanged({ versions })
  }

  private recordedOf(resource: PodResource<unknown>): boolean {
    return recordedOf({ events: this.args.ctx.events(), resource })
  }

  private missingOf(): PodResource<unknown>[] {
    return this.args.resources.filter((resource) => !this.recordedOf(resource))
  }

  private async versionsForTurn(): Promise<Versions> {
    if (!this.args.resources.some((resource) => resource.cloud !== undefined)) {
      return versionsOf({ ctx: this.args.ctx, needed: false })
    }
    return spanWith(this.args.trace, {
      name: ESpan.ResourceVersions,
      run: () => versionsOf({ ctx: this.args.ctx, needed: true }),
    })
  }

  private async adoptMissing(args: { versions: Versions }): Promise<PodResource<unknown>[]> {
    const missing = this.missingOf()
    if (missing.length === 0) return []
    const sharedEvents = this.args.shared?.()
    if (sharedEvents === undefined) return missing
    const stillMissing: PodResource<unknown>[] = []
    for (const resource of missing) {
      const snapshot = this.adoptedOf({ events: sharedEvents, resource, versions: args.versions })
      const adopted =
        snapshot === undefined
          ? false
          : await this.args.adoptOf({
              resource,
              fingerprint: snapshot.fingerprint,
              value: snapshot.value,
            })
      if (!adopted) stillMissing.push(resource)
    }
    return stillMissing
  }

  private adoptedOf(args: {
    events: readonly RecordEvent[]
    resource: PodResource<unknown>
    versions: Versions
  }): { fingerprint: string; value: unknown } | undefined {
    const latest = latestResourceOf({ events: args.events, resource: args.resource.name })
    if (latest === undefined) return undefined
    const cloud = cloudStringOf({ settings: args.resource.cloud, versions: args.versions })
    const under = loadedUnderCloudOf({
      fingerprint: latest.fingerprint,
      cloud,
      directory: this.args.directory(),
    })
    if (!under) return undefined
    const parsed = args.resource.schema.safeParse(latest.value)
    if (!parsed.success) return undefined
    if (args.resource.stale?.(parsed.data) === true) return undefined
    return { fingerprint: latest.fingerprint, value: parsed.data }
  }

  private async reloadCloudChanged(args: { versions: Versions }): Promise<void> {
    const cloud = this.args.resources.filter((resource) => resource.cloud !== undefined)
    if (cloud.length === 0) return
    if (!versionsKnownOf(args.versions)) return
    const changed = cloud.filter((resource) =>
      this.cloudChangedOf({ resource, versions: args.versions }),
    )
    for (const resource of changed) {
      if (resource.background !== true) continue
      void this.reloadWhenSettled({ resource, versions: args.versions })
    }
    const awaited = changed.filter((resource) => resource.background !== true)
    for (const resource of awaited) {
      if (!this.args.podReady()) {
        void this.reloadWhenSettled({ resource, versions: args.versions })
        continue
      }
      await this.args.waitOn({
        waitFor: EResourceWait.ChangedResource,
        resource: resource.name,
        work: () => this.reloadWhenSettled({ resource, versions: args.versions }),
      })
    }
  }

  private async reloadWhenSettled(args: {
    resource: PodResource<unknown>
    versions: Versions
  }): Promise<void> {
    const planned = this.args.plannedOf()
    if (planned !== undefined) await planned.catch(() => undefined)
    if (args.resource.background === true) {
      const background = this.args.backgroundLoadOf(args.resource.name)
      if (background !== undefined) await background.catch(() => undefined)
    } else {
      const refreshed = this.args.refreshLoadOf(args.resource.name)
      if (refreshed !== undefined) await refreshed.catch(() => undefined)
    }
    if (!this.cloudChangedOf(args)) return
    await this.reloadOf(args.resource)
  }

  private reloadOf(resource: PodResource<unknown>): Promise<void> {
    return this.args.reload({
      resource,
      directory: this.args.directory(),
      reason: ELoadReason.Cloud,
    })
  }

  private cloudChangedOf(args: { resource: PodResource<unknown>; versions: Versions }): boolean {
    const latest = latestResourceOf({
      events: this.args.ctx.events(),
      resource: args.resource.name,
    })
    if (latest === undefined) return false
    return !loadedUnderCloudOf({
      fingerprint: latest.fingerprint,
      cloud: cloudStringOf({ settings: args.resource.cloud, versions: args.versions }),
      directory: this.args.directory(),
    })
  }
}
