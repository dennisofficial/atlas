import {
  ESettingId,
  ESettingsLayer,
  resolveSettings,
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

export type SettingsSnapshot = {
  resolution: SettingsResolution
  document: SettingsDocument
  writesTo: string
  problems: readonly string[]
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
}): SettingsService {
  const listeners = new Set<() => void>()
  let definitions = args.definitions
  let cloud = args.cloud
  let cloudProblem: string | undefined
  let version = 0
  let snapshot = build()
  cloud?.subscribe(republish)

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

  function persist(next: SettingsDocument): SettingsWrite {
    try {
      args.user.write(next)
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }

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
      return persist(withSetting({ document: snapshot.document, id, value }))
    },
    clear: ({ id }) => {
      if (isCloudSettingId(id)) {
        return writeCloud(() => cloud?.remove({ key: id }) ?? Promise.resolve())
      }
      return persist(withoutSetting({ document: snapshot.document, id }))
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
      cloud.subscribe(republish)
      republish()
    },
    reload: republish,
  }
}
