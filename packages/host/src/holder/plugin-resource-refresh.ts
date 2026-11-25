import { latestResourceOf, resourceFingerprintOf, type RecordEvent } from '@dltech/atlas-core'
import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'
import type {
  ECloudSetting,
  PluginPodContext,
  PodResource,
  ResourceWatch,
} from '@dltech/atlas-plugin-sdk'

import { appendOf, draftsOf, loadOf, startInBackground } from './plugin-resource-loads'
import { armOf, cloudStringOf, statusOf, versionsOf, watchIdOf } from './plugin-resource-probes'
import { ELoadReason, reasonOf } from './plugin-resource-reason'

export const RELOADED = 'reloaded'

type Ctx = PluginPodContext

type Appended = Parameters<PluginPodContext['append']>[0][number]

type Watch = { readonly spec: ResourceWatch; readonly id: string }

type Entry = { readonly resource: PodResource<unknown>; readonly watch: Watch | undefined }

type Candidate = Entry & {
  readonly cloud: string
  readonly seq: number | undefined
  readonly reason: ELoadReason
}

type Prepared = Candidate & { readonly fingerprint: string }

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

export const refresh = async (args: {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  projectDirectory: string
  trace: TracePort | undefined
  shared: (() => readonly RecordEvent[]) | undefined
  loadingOf?: ((resource: string) => boolean) | undefined
  onBackground?: ((background: { resource: string; loading: Promise<void> }) => void) | undefined
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
  if (status.unreachable) {
    ctx.log('plugin resources left as they are: the sandbox did not answer the watch status call')
    return
  }
  const candidates = staleOf({
    entries,
    events: ctx.events(),
    instance: status.instance,
    seqs: status.seqs,
    versions,
    directory: projectDirectory,
  })
  const sharedEvents = shared?.() ?? []

  const adopted: Appended[] = []
  const arms = new Map<string, { watch: Watch; resource: string }>()
  const loadable: Candidate[] = []
  for (const candidate of candidates) {
    const known = resourceFingerprintOf({
      instance: status.instance,
      seq: candidate.seq,
      cloud: candidate.cloud,
      directory: projectDirectory,
    })
    const snapshot =
      shared === undefined
        ? undefined
        : sharedValueOf({
            resource: candidate.resource,
            events: sharedEvents,
            fingerprint: known,
            live: candidate.watch === undefined || candidate.seq !== undefined,
          })
    if (snapshot !== undefined) {
      adopted.push(
        ...draftsOf({
          resource: candidate.resource,
          ctx,
          value: snapshot.value,
          fingerprint: known,
        }),
      )
      continue
    }
    const watch = candidate.watch
    if (watch !== undefined && candidate.seq === undefined && !arms.has(watch.id)) {
      arms.set(watch.id, { watch, resource: candidate.resource.name })
    }
    loadable.push(candidate)
  }

  const reachable = await Promise.all(
    [...arms.values()].map(({ watch, resource }) =>
      spanWith(trace, {
        name: ESpan.ResourceArm,
        fields: { resource },
        run: () => armOf({ ctx, watchId: watch.id, watch: watch.spec }),
      }),
    ),
  )
  await appendOf({ ctx, trace, drafts: adopted })
  if (reachable.includes(false)) {
    ctx.log('plugin resources left as they are: the sandbox did not answer the watch arm call')
    return
  }

  const prepared: Prepared[] = loadable.map((candidate) => {
    const seq = candidate.watch === undefined ? candidate.seq : (candidate.seq ?? 0)
    return {
      ...candidate,
      seq,
      fingerprint: resourceFingerprintOf({
        instance: status.instance,
        seq,
        cloud: candidate.cloud,
        directory: projectDirectory,
      }),
    }
  })

  for (const entry of prepared) {
    if (entry.resource.background !== true) continue
    if (args.loadingOf?.(entry.resource.name) === true) continue
    const loading = startInBackground({ ctx, trace, entry, directory: projectDirectory })
    args.onBackground?.({ resource: entry.resource.name, loading })
  }

  await Promise.all(
    prepared
      .filter((entry) => entry.resource.background !== true)
      .map(async (entry) => {
        const drafts = await loadOf({ ctx, trace, entry, directory: projectDirectory })
        await appendOf({ ctx, trace, drafts })
      }),
  )
}
