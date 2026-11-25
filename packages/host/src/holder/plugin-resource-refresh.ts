import { latestResourceOf, resourceFingerprintOf, type RecordEvent } from '@dltech/atlas-core'
import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'
import type {
  ECloudSetting,
  PluginPodContext,
  PodResource,
  ResourceWatch,
} from '@dltech/atlas-plugin-sdk'

import { appendOf, loadedDraftsOf } from './plugin-resource-drafts'
import {
  armOf,
  cloudStringOf,
  messageOf,
  statusOf,
  versionsOf,
  watchIdOf,
} from './plugin-resource-probes'
import { ELoadReason, reasonOf } from './plugin-resource-reason'

type Ctx = PluginPodContext

type Watch = { readonly spec: ResourceWatch; readonly id: string }

type Entry = { readonly resource: PodResource<unknown>; readonly watch: Watch | undefined }

type Candidate = Entry & {
  readonly cloud: string
  readonly seq: number | undefined
  readonly reason: ELoadReason
}

type Prepared = Candidate & { readonly fingerprint: string }

export type Adoption = {
  readonly resource: PodResource<unknown>
  readonly fingerprint: string
  readonly value: unknown
}

export type Adopt = (adoption: Adoption) => Promise<boolean>

export const watchOf = (args: {
  resource: PodResource<unknown>
  directory: string
}): Watch | undefined => {
  const spec = args.resource.watch?.(args.directory)
  return spec === undefined ? undefined : { spec, id: watchIdOf(spec) }
}

const staleOf = (args: {
  entries: readonly Entry[]
  events: readonly RecordEvent[]
  instance: string
  seqs: ReadonlyMap<string, number>
  versions: Readonly<Record<ECloudSetting, string>>
  directory: string
}): Candidate[] =>
  args.entries.flatMap((entry) => {
    const seq = entry.watch === undefined ? undefined : args.seqs.get(entry.watch.id)
    const latest = latestResourceOf({ events: args.events, resource: entry.resource.name })
    const cloud = cloudStringOf({ settings: entry.resource.cloud, versions: args.versions })
    const fingerprint = resourceFingerprintOf({
      instance: args.instance,
      seq,
      cloud,
      directory: args.directory,
    })
    const settled =
      latest !== undefined &&
      latest.fingerprint === fingerprint &&
      (entry.watch === undefined || seq !== undefined)
    const staledByValue = latest !== undefined && entry.resource.stale?.(latest.value) === true
    if (settled && !staledByValue) return []
    return [
      {
        ...entry,
        cloud,
        seq,
        reason: reasonOf({ latest, staledByValue, instance: args.instance, seq }),
      },
    ]
  })

const sharedValueOf = (args: {
  resource: PodResource<unknown>
  events: readonly RecordEvent[]
  fingerprint: string
  live: boolean
}): { value: unknown } | undefined => {
  if (!args.live) return undefined
  const latest = latestResourceOf({ events: args.events, resource: args.resource.name })
  if (latest === undefined || latest.fingerprint !== args.fingerprint) return undefined
  const parsed = args.resource.schema.safeParse(latest.value)
  if (!parsed.success) return undefined
  if (args.resource.stale?.(parsed.data) === true) return undefined
  return { value: parsed.data }
}

const adoptOf = async (args: {
  adopt: Adopt
  candidate: Candidate
  sharedEvents: readonly RecordEvent[]
  instance: string
  directory: string
}): Promise<boolean> => {
  const known = resourceFingerprintOf({
    instance: args.instance,
    seq: args.candidate.seq,
    cloud: args.candidate.cloud,
    directory: args.directory,
  })
  const snapshot = sharedValueOf({
    resource: args.candidate.resource,
    events: args.sharedEvents,
    fingerprint: known,
    live: args.candidate.watch === undefined || args.candidate.seq !== undefined,
  })
  if (snapshot === undefined) return false
  return args.adopt({
    resource: args.candidate.resource,
    fingerprint: known,
    value: snapshot.value,
  })
}

const armedOf = (args: {
  ctx: Ctx
  trace: TracePort | undefined
  watch: Watch
  resource: string
  armed: Map<string, Promise<void>>
}): Promise<void> => {
  const running = args.armed.get(args.watch.id)
  if (running !== undefined) return running
  const attempt = spanWith(args.trace, {
    name: ESpan.ResourceArm,
    fields: { resource: args.resource },
    run: () => armOf({ ctx: args.ctx, watchId: args.watch.id, watch: args.watch.spec }),
  })
  args.armed.set(args.watch.id, attempt)
  return attempt
}

const startInBackground = (args: { ctx: Ctx; entry: Prepared; directory: string }): Promise<void> =>
  loadedDraftsOf({
    resource: args.entry.resource,
    ctx: args.ctx,
    directory: args.directory,
    fingerprint: args.entry.fingerprint,
  })
    .then(async (drafts) => {
      await args.ctx.append(drafts)
    })
    .catch((failure: unknown) => {
      args.ctx.log(
        `plugin resource ${args.entry.resource.name} could not load in the background: ${messageOf(failure)}`,
      )
    })

const workOf = async (args: {
  ctx: Ctx
  trace: TracePort | undefined
  candidate: Candidate
  instance: string
  directory: string
  armed: Map<string, Promise<void>>
}): Promise<void> => {
  const { candidate } = args
  const watch = candidate.watch
  if (watch !== undefined && candidate.seq === undefined) {
    await armedOf({
      ctx: args.ctx,
      trace: args.trace,
      watch,
      resource: candidate.resource.name,
      armed: args.armed,
    })
  }
  const seq = watch === undefined ? candidate.seq : (candidate.seq ?? 0)
  const entry: Prepared = {
    ...candidate,
    seq,
    fingerprint: resourceFingerprintOf({
      instance: args.instance,
      seq,
      cloud: candidate.cloud,
      directory: args.directory,
    }),
  }
  if (candidate.resource.background === true) {
    await startInBackground({ ctx: args.ctx, entry, directory: args.directory })
    return
  }
  const drafts = await spanWith(args.trace, {
    name: ESpan.ResourceLoad,
    fields: { resource: entry.resource.name, phase: entry.reason },
    run: () =>
      loadedDraftsOf({
        resource: entry.resource,
        ctx: args.ctx,
        directory: args.directory,
        fingerprint: entry.fingerprint,
      }),
  }).catch((failure: unknown) => {
    args.ctx.log(`plugin resource ${entry.resource.name} could not load: ${messageOf(failure)}`)
    return []
  })
  await appendOf({ ctx: args.ctx, trace: args.trace, drafts })
}

export const refresh = async (args: {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  projectDirectory: string
  trace: TracePort | undefined
  shared: (() => readonly RecordEvent[]) | undefined
  adopt: Adopt
  loadingOf?: ((resource: string) => boolean) | undefined
  onBackground?: ((background: { resource: string; loading: Promise<void> }) => void) | undefined
  onLoad?: ((load: { resource: string; loading: Promise<void> }) => void) | undefined
  onPlanned?: (() => void) | undefined
  onReached?: ((reached: boolean) => void) | undefined
}): Promise<void> => {
  const { ctx, resources, projectDirectory, trace, shared } = args
  const entries: Entry[] = resources.map((resource) => ({
    resource,
    watch: watchOf({ resource, directory: projectDirectory }),
  }))
  const watchIds = [
    ...new Set(entries.flatMap((entry) => (entry.watch === undefined ? [] : [entry.watch.id]))),
  ]
  const [status, versions] = await Promise.all([
    spanWith(trace, { name: ESpan.ResourceStatus, run: () => statusOf({ ctx, watchIds }) }),
    spanWith(trace, {
      name: ESpan.ResourceVersions,
      run: () =>
        versionsOf({ ctx, needed: resources.some((resource) => resource.cloud !== undefined) }),
    }),
  ])
  args.onReached?.(status.reached)
  const candidates = staleOf({
    entries,
    events: ctx.events(),
    instance: status.instance,
    seqs: status.seqs,
    versions,
    directory: projectDirectory,
  })
  const sharedEvents = shared?.() ?? []

  const loadable: Candidate[] = []
  for (const candidate of candidates) {
    if (shared !== undefined) {
      const adopted = await adoptOf({
        adopt: args.adopt,
        candidate,
        sharedEvents,
        instance: status.instance,
        directory: projectDirectory,
      })
      if (adopted) continue
    }
    if (candidate.watch !== undefined && !status.reached) continue
    loadable.push(candidate)
  }

  const armed = new Map<string, Promise<void>>()
  const awaited: Promise<void>[] = []
  for (const candidate of loadable) {
    if (
      candidate.resource.background === true &&
      args.loadingOf?.(candidate.resource.name) === true
    ) {
      continue
    }
    const loading = workOf({
      ctx,
      trace,
      candidate,
      instance: status.instance,
      directory: projectDirectory,
      armed,
    })
    if (candidate.resource.background === true) {
      args.onBackground?.({ resource: candidate.resource.name, loading })
      continue
    }
    args.onLoad?.({ resource: candidate.resource.name, loading })
    awaited.push(loading)
  }
  args.onPlanned?.()
  await Promise.all(awaited)
}
