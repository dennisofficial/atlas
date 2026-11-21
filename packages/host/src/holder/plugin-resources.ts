import type { RegisteredHook } from '@dltech/atlas-agent'
import {
  latestResourceOf,
  resourceFingerprintOf,
  EStage,
  type BeforeTurn,
  type V2Event,
} from '@dltech/atlas-core'
import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'
import type {
  ECloudSetting,
  PluginPodContext,
  PodResource,
  ResourceWatch,
} from '@dltech/atlas-plugin-sdk'

import {
  armOf,
  cloudStringOf,
  messageOf,
  statusOf,
  versionsOf,
  watchIdOf,
} from './plugin-resource-probes'

const RELOADED = 'reloaded'

type Ctx = PluginPodContext

type Appended = Parameters<PluginPodContext['append']>[0][number]

type Watch = { readonly spec: ResourceWatch; readonly id: string }

type Entry = { readonly resource: PodResource<unknown>; readonly watch: Watch | undefined }

type Candidate = Entry & { readonly cloud: string; readonly seq: number | undefined }

type Prepared = Candidate & { readonly fingerprint: string }

const watchOf = (args: {
  resource: PodResource<unknown>
  directory: string
}): Watch | undefined => {
  const spec = args.resource.watch?.(args.directory)
  return spec === undefined ? undefined : { spec, id: watchIdOf(spec) }
}

const draftsOf = <T>(args: {
  resource: PodResource<T>
  ctx: Ctx
  value: T
  fingerprint: string
}): Appended[] => [
  {
    type: 'resource-loaded',
    resource: args.resource.name,
    fingerprint: args.fingerprint,
    value: args.value,
  },
  ...(args.resource.announce?.(args.value, args.ctx) ?? []),
]

const loadedDraftsOf = async <T>(args: {
  resource: PodResource<T>
  ctx: Ctx
  directory: string
  fingerprint: string
}): Promise<Appended[]> => {
  const value = await args.resource.load({ ctx: args.ctx, directory: args.directory })
  const parsed = args.resource.schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`${args.resource.name} loaded a value its own schema refused`)
  }
  return draftsOf({
    resource: args.resource,
    ctx: args.ctx,
    value: parsed.data,
    fingerprint: args.fingerprint,
  })
}

export const reloadResource = async (args: {
  ctx: Ctx
  resource: PodResource<unknown>
  directory: string
}): Promise<void> => {
  try {
    const drafts = await loadedDraftsOf({
      resource: args.resource,
      ctx: args.ctx,
      directory: args.directory,
      fingerprint: RELOADED,
    })
    await args.ctx.append(drafts)
  } catch (failure) {
    args.ctx.log(`plugin resource ${args.resource.name} could not reload: ${messageOf(failure)}`)
  }
}

const staleOf = (args: {
  entries: readonly Entry[]
  events: readonly V2Event[]
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
    return [{ ...entry, cloud, seq }]
  })

const sharedValueOf = (args: {
  resource: PodResource<unknown>
  events: readonly V2Event[]
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

const refresh = async (args: {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  projectDirectory: string
  trace: TracePort | undefined
  shared: (() => readonly V2Event[]) | undefined
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
  const prepared: Prepared[] = []
  const armed = new Set<string>()
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
    let seq = candidate.seq
    if (candidate.watch !== undefined && seq === undefined) {
      const watch = candidate.watch
      if (!armed.has(watch.id)) {
        await spanWith(trace, {
          name: ESpan.ResourceArm,
          fields: { resource: candidate.resource.name },
          run: () => armOf({ ctx, watchId: watch.id, watch: watch.spec }),
        })
        armed.add(watch.id)
      }
      seq = 0
    }
    prepared.push({
      ...candidate,
      seq,
      fingerprint: resourceFingerprintOf({
        instance: status.instance,
        seq,
        cloud: candidate.cloud,
        directory: projectDirectory,
      }),
    })
  }

  for (const entry of prepared) {
    if (entry.resource.background !== true) continue
    startInBackground({ ctx, entry, directory: projectDirectory })
  }

  const loading = prepared
    .filter((entry) => entry.resource.background !== true)
    .map((entry) =>
      spanWith(trace, {
        name: ESpan.ResourceLoad,
        fields: { resource: entry.resource.name },
        run: () =>
          loadedDraftsOf({
            resource: entry.resource,
            ctx,
            directory: projectDirectory,
            fingerprint: entry.fingerprint,
          }),
      }).catch((failure: unknown) => {
        ctx.log(`plugin resource ${entry.resource.name} could not load: ${messageOf(failure)}`)
        return [] as Appended[]
      }),
    )
  const drafts = [...adopted, ...(await Promise.all(loading)).flat()]
  if (drafts.length === 0) return
  await spanWith(trace, {
    name: ESpan.ResourceAppend,
    fields: { drafts: drafts.length },
    run: () => ctx.append(drafts),
  })
}

const startInBackground = (args: { ctx: Ctx; entry: Prepared; directory: string }): void => {
  void loadedDraftsOf({
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
}

export const pluginResourcesHook = (args: {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  trace?: TracePort | undefined
  shared?: (() => readonly V2Event[]) | undefined
}): RegisteredHook<BeforeTurn> => ({
  name: 'plugin-resources',
  order: { stage: EStage.Guard, nudge: 0 },
  run: async ({ projectDirectory }) => {
    await refresh({
      ctx: args.ctx,
      resources: args.resources,
      projectDirectory,
      trace: args.trace,
      shared: args.shared,
    })
    return {}
  },
})
