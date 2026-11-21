import type { RegisteredHook } from '@dltech/atlas-agent'
import {
  latestResourceOf,
  resourceFingerprintOf,
  EStage,
  type BeforeTurn,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  ECloudSetting,
  type PluginPodContext,
  type PodResource,
  type ResourceWatch,
} from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'

const WATCH_DEBOUNCE_MS = 150
const UNKNOWN = 'unknown'
const DISALLOWED = /[^A-Za-z0-9_.:-]/g
const RELOADED = 'reloaded'

type Ctx = PluginPodContext

type Appended = Parameters<PluginPodContext['append']>[0][number]

type Entry = {
  resource: PodResource<unknown>
  watch: ResourceWatch | undefined
  watchId: string
}

type Candidate = Entry & { cloud: string; seq: number | undefined }

type Prepared = Candidate & { fingerprint: string }

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const watchIdOf = (args: { name: string; threadId: ThreadId }): string =>
  `resource.${args.name}.${args.threadId}`.replace(DISALLOWED, '-')

const unknownVersions = (): Readonly<Record<ECloudSetting, string>> => ({
  [ECloudSetting.McpServers]: UNKNOWN,
  [ECloudSetting.Skills]: UNKNOWN,
  [ECloudSetting.PersonalInstructions]: UNKNOWN,
})

const versionsOf = async (args: {
  ctx: Ctx
  needed: boolean
}): Promise<Readonly<Record<ECloudSetting, string>>> => {
  if (!args.needed) return unknownVersions()
  try {
    return await args.ctx.control.settingsVersions()
  } catch (failure) {
    args.ctx.log(`plugin resources could not read cloud versions: ${messageOf(failure)}`)
    return unknownVersions()
  }
}

const cloudStringOf = (args: {
  settings: readonly ECloudSetting[] | undefined
  versions: Readonly<Record<ECloudSetting, string>>
}): string => {
  if (args.settings === undefined) return ''
  return Object.values(ECloudSetting)
    .filter((setting) => args.settings?.includes(setting) === true)
    .map((setting) => args.versions[setting])
    .join('|')
}

const statusOf = async (args: {
  ctx: Ctx
  watchIds: readonly string[]
}): Promise<{ instance: string; seqs: ReadonlyMap<string, number> }> => {
  if (args.watchIds.length === 0) return { instance: UNKNOWN, seqs: new Map() }
  try {
    const result = await args.ctx.call({ op: 'watch.status', watchIds: [...args.watchIds] })
    if (result.status !== ECallStatus.Ok) throw new Error(result.error.message)
    if (result.op !== 'watch.status') throw new Error('the daemon answered another operation')
    return {
      instance: result.value.instance,
      seqs: new Map(result.value.watches.map((entry) => [entry.watchId, entry.seq])),
    }
  } catch (failure) {
    args.ctx.log(`plugin resources could not read watch status: ${messageOf(failure)}`)
    return { instance: UNKNOWN, seqs: new Map() }
  }
}

const armOf = async (args: { ctx: Ctx; watchId: string; watch: ResourceWatch }): Promise<void> => {
  try {
    await args.ctx.call({
      op: 'watch.start',
      watchId: args.watchId,
      roots: [...args.watch.roots],
      debounceMs: WATCH_DEBOUNCE_MS,
      ...(args.watch.basenames === undefined ? {} : { basenames: [...args.watch.basenames] }),
    })
  } catch (failure) {
    args.ctx.log(`plugin resources could not watch ${args.watchId}: ${messageOf(failure)}`)
  }
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
  events: ReturnType<Ctx['events']>
  instance: string
  seqs: ReadonlyMap<string, number>
  versions: Readonly<Record<ECloudSetting, string>>
  directory: string
}): Candidate[] =>
  args.entries.flatMap((entry) => {
    const seq = entry.watch === undefined ? undefined : args.seqs.get(entry.watchId)
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

const refresh = async (args: {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  threadId: ThreadId
  projectDirectory: string
}): Promise<void> => {
  const { ctx, resources, threadId, projectDirectory } = args
  const entries: Entry[] = resources.map((resource) => ({
    resource,
    watch: resource.watch?.(projectDirectory),
    watchId: watchIdOf({ name: resource.name, threadId }),
  }))
  const watchIds = entries.flatMap((entry) => (entry.watch === undefined ? [] : [entry.watchId]))
  const [status, versions] = await Promise.all([
    statusOf({ ctx, watchIds }),
    versionsOf({ ctx, needed: resources.some((resource) => resource.cloud !== undefined) }),
  ])
  const candidates = staleOf({
    entries,
    events: ctx.events(),
    instance: status.instance,
    seqs: status.seqs,
    versions,
    directory: projectDirectory,
  })

  const prepared: Prepared[] = []
  for (const candidate of candidates) {
    const latest = latestResourceOf({ events: ctx.events(), resource: candidate.resource.name })
    const directoryChanged =
      latest === undefined || !latest.fingerprint.endsWith(`:${projectDirectory}`)
    let seq = candidate.seq
    if (candidate.watch !== undefined && (seq === undefined || directoryChanged)) {
      await armOf({ ctx, watchId: candidate.watchId, watch: candidate.watch })
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
      loadedDraftsOf({
        resource: entry.resource,
        ctx,
        directory: projectDirectory,
        fingerprint: entry.fingerprint,
      }).catch((failure: unknown) => {
        ctx.log(`plugin resource ${entry.resource.name} could not load: ${messageOf(failure)}`)
        return [] as Appended[]
      }),
    )
  const drafts = (await Promise.all(loading)).flat()
  if (drafts.length > 0) await ctx.append(drafts)
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
}): RegisteredHook<BeforeTurn> => ({
  name: 'plugin-resources',
  order: { stage: EStage.Guard, nudge: 0 },
  run: async ({ threadId, projectDirectory }) => {
    await refresh({
      ctx: args.ctx,
      resources: args.resources,
      threadId,
      projectDirectory,
    })
    return {}
  },
})
