import {
  EMPTY_SETTINGS_DOCUMENT,
  ESettingId,
  ESettingsLayer,
  resolveSettings,
  serialiseSettingsDocument,
  withoutSetting,
  withSetting,
  type SettingDefinition,
  type SettingsDocument,
  type SettingsLayerInput,
  type SettingsResolution,
  type SettingsStorePort,
  type SettingValue,
} from '@dltech/atlas-core'

import { isCloudSettingId } from '../cloud/settings-definitions'
import { watchSettingsFiles, type SettingsWatchHandle } from './watcher'

export type SettingsSnapshot = {
  resolution: SettingsResolution
  document: SettingsDocument
  writesTo: string
  problems: readonly string[]
}

export type SettingsLayerReads = {
  user: SettingsDocument
  project: SettingsDocument | undefined
}

export type SettingsWrite = { ok: true } | { ok: false; message: string }

/**
 * The slice of the cloud settings cache the service routes through. Structural, so the harness's
 * CloudSettingsStore satisfies it without the settings module importing the cloud client stack.
 */
export type CloudSettingsPort = {
  signedIn: () => boolean
  values: () => Record<string, string>
  set: (args: { key: string; value: string }) => Promise<void>
  remove: (args: { key: string }) => Promise<void>
  subscribe: (listener: () => void) => () => void
}

export type SettingsService = {
  readonly definitions: readonly SettingDefinition[]
  snapshot: () => SettingsSnapshot
  version: () => number
  subscribe: (listener: () => void) => () => void
  set: (args: { id: string; value: SettingValue }) => SettingsWrite
  clear: (args: { id: string }) => SettingsWrite
  /** Late-registered rows — the per-agent-type model picks exist only once the types are loaded. */
  register: (extra: readonly SettingDefinition[]) => void
  /** The cloud store exists only once the composition root has built it; the env layer is already whole. */
  attachCloud: (cloud: CloudSettingsPort) => void
  reload: () => void
  /** Stops file watching. The service keeps answering from its held snapshot afterwards. */
  close: () => void
}

export type SettingsWatchOptions = {
  files: readonly string[]
  debounceMs?: number
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'could not be written'

const SIGN_IN_TO_CHANGE = 'sign in to Atlas Cloud to change this'

const CLOUD_LAYER_ORIGIN = 'atlas cloud'

export function createSettingsService(args: {
  definitions: readonly SettingDefinition[]
  user: SettingsStorePort
  project?: SettingsStorePort
  environment?: SettingsLayerInput
  cloud?: CloudSettingsPort
  watch?: SettingsWatchOptions
}): SettingsService {
  const listeners = new Set<() => void>()
  let definitions = args.definitions
  let cloud = args.cloud
  let cloudProblem: string | undefined
  let watcher: SettingsWatchHandle | undefined
  let version = 0
  let layerReads: SettingsLayerReads = { user: EMPTY_SETTINGS_DOCUMENT, project: undefined }
  let snapshot = build()
  let attachUnsubscribe: (() => void) | undefined = cloud?.subscribe(republish)

  function withoutCloudIds(
    values: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    const kept: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      if (!isCloudSettingId(key)) kept[key] = value
    }
    return kept
  }

  function readLayer(store: SettingsStorePort, layer: ESettingsLayer) {
    const read = store.read()
    return {
      input: { layer, origin: store.origin(), values: withoutCloudIds(read.document.values) },
      document: read.document,
      ...(read.problem === undefined ? {} : { problem: read.problem }),
    }
  }

  function cloudLayer(): SettingsLayerInput | undefined {
    if (cloud === undefined || !cloud.signedIn()) return undefined

    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(cloud.values())) {
      // cloud.url bootstraps the cloud client itself, so it can never come back out of it.
      if (key === ESettingId.CloudUrl) continue
      values[key] = value
    }
    if (Object.keys(values).length === 0) return undefined

    return { layer: ESettingsLayer.Cloud, origin: CLOUD_LAYER_ORIGIN, values }
  }

  function build(): SettingsSnapshot {
    const user = readLayer(args.user, ESettingsLayer.User)
    const project =
      args.project === undefined ? undefined : readLayer(args.project, ESettingsLayer.Project)
    layerReads = { user: user.document, project: project?.document }

    const layers: SettingsLayerInput[] = [user.input]
    if (project !== undefined) layers.push(project.input)
    if (args.environment !== undefined) layers.push(args.environment)
    const fromCloud = cloudLayer()
    if (fromCloud !== undefined) layers.push(fromCloud)

    const problems: string[] = []
    if (user.problem !== undefined) problems.push(user.problem)
    if (project?.problem !== undefined) problems.push(project.problem)
    if (cloudProblem !== undefined) problems.push(cloudProblem)

    return {
      resolution: resolveSettings({ definitions, layers }),
      document: user.document,
      writesTo: args.user.origin(),
      problems,
    }
  }

  function republish(): void {
    snapshot = build()
    version += 1
    for (const listener of listeners) listener()
  }

  /**
   * Another tile's write lands through the same file we write to. Republish only on a real change,
   * or our own writes would echo back as a second notification. A layer that fails to read keeps
   * its last-good document: a torn file must not knock the running tiles back to fallbacks, and a
   * cloud write failure is no reason to stop listening for file changes.
   */
  function reloadExternal(): void {
    const priorUser = layerReads.user
    const priorProject = layerReads.project ?? EMPTY_SETTINGS_DOCUMENT
    const priorProblems = snapshot.problems.length
    const next = build()

    if (next.problems.length > priorProblems) {
      layerReads = { user: priorUser, project: priorProject }
      return
    }

    const nextProject = layerReads.project ?? EMPTY_SETTINGS_DOCUMENT
    const unchanged =
      serialiseSettingsDocument(next.document) === serialiseSettingsDocument(snapshot.document) &&
      serialiseSettingsDocument(nextProject) === serialiseSettingsDocument(priorProject)
    if (unchanged) return

    snapshot = next
    version += 1
    for (const listener of listeners) listener()
  }

  function armWatcher(): void {
    if (args.watch === undefined) return
    watcher?.close()
    watcher = watchSettingsFiles({
      files: args.watch.files,
      onChange: reloadExternal,
      ...(args.watch.debounceMs === undefined ? {} : { debounceMs: args.watch.debounceMs }),
    })
  }

  armWatcher()

  function freshDocument(): SettingsDocument {
    try {
      const read = args.user.read()
      // A store answers a torn or unreadable file with a problem and an empty document, not a
      // throw — merging onto that would empty every other tile's settings on the next write.
      if (read.problem !== undefined) return snapshot.document
      return read.document
    } catch {
      return snapshot.document
    }
  }

  function persist(change: (document: SettingsDocument) => SettingsDocument): SettingsWrite {
    try {
      args.user.write(change(freshDocument()))
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }

    // The write may have created a directory the boot-time watch could not see (a project with no
    // .atlas/ yet); re-arm so later external edits on that layer are picked up too.
    armWatcher()
    republish()
    return { ok: true }
  }

  function writeCloud(write: () => Promise<void>): SettingsWrite {
    if (cloud === undefined || !cloud.signedIn()) {
      return { ok: false, message: SIGN_IN_TO_CHANGE }
    }

    void write().then(
      () => {
        cloudProblem = undefined
        republish()
      },
      (error: unknown) => {
        cloudProblem = `Atlas Cloud could not save the setting (${messageOf(error)})`
        republish()
      },
    )
    return { ok: true }
  }

  return {
    get definitions() {
      return definitions
    },
    snapshot: () => snapshot,
    version: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: ({ id, value }) => {
      if (isCloudSettingId(id)) {
        return writeCloud(() => cloud?.set({ key: id, value: String(value) }) ?? Promise.resolve())
      }
      return persist((document) => withSetting({ document, id, value }))
    },
    clear: ({ id }) => {
      if (isCloudSettingId(id)) {
        return writeCloud(() => cloud?.remove({ key: id }) ?? Promise.resolve())
      }
      return persist((document) => withoutSetting({ document, id }))
    },
    register: (extra) => {
      const known = new Set(definitions.map((definition) => definition.id))
      const novel = extra.filter((definition) => !known.has(definition.id))
      if (novel.length === 0) return
      definitions = [...definitions, ...novel]
      republish()
    },
    attachCloud: (store) => {
      if (cloud !== undefined) return
      cloud = store
      attachUnsubscribe = cloud.subscribe(republish)
      republish()
    },
    reload: republish,
    close: () => {
      watcher?.close()
      watcher = undefined
      attachUnsubscribe?.()
      attachUnsubscribe = undefined
    },
  }
}
