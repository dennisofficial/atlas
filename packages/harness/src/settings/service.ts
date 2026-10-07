import {
  EMPTY_SETTINGS_DOCUMENT,
  ESettingsLayer,
  parseSettingsDocument,
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

export type SettingsService = {
  readonly definitions: readonly SettingDefinition[]
  snapshot: () => SettingsSnapshot
  version: () => number
  subscribe: (listener: () => void) => () => void
  set: (args: { id: string; value: SettingValue }) => SettingsWrite
  clear: (args: { id: string }) => SettingsWrite
  applyUserDocument: (document: SettingsDocument) => SettingsWrite
  writeOrigin: (id: string) => string | undefined
  register: (extra: readonly SettingDefinition[]) => void
  reload: () => void
  close: () => void
}

export type SettingsWatchOptions = {
  files: readonly string[]
  debounceMs?: number
}

type WriteTarget = {
  store: SettingsStorePort
  cached: () => SettingsDocument
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'could not be written'

export function createSettingsService(args: {
  definitions: readonly SettingDefinition[]
  user: SettingsStorePort
  project?: SettingsStorePort
  environment?: SettingsLayerInput
  watch?: SettingsWatchOptions
}): SettingsService {
  const listeners = new Set<() => void>()
  let definitions = args.definitions
  let watcher: SettingsWatchHandle | undefined
  let version = 0
  let layerReads: SettingsLayerReads = { user: EMPTY_SETTINGS_DOCUMENT, project: undefined }
  let snapshot = build()

  function readLayer(store: SettingsStorePort, layer: ESettingsLayer) {
    const read = store.read()
    const cached = layer === ESettingsLayer.Project ? layerReads.project : layerReads.user
    const document = read.problem === undefined ? read.document : (cached ?? EMPTY_SETTINGS_DOCUMENT)
    return {
      input: { layer, origin: store.origin(), values: document.values },
      document,
      ...(read.problem === undefined ? {} : { problem: read.problem }),
    }
  }

  function build(): SettingsSnapshot {
    const user = readLayer(args.user, ESettingsLayer.User)
    const project =
      args.project === undefined ? undefined : readLayer(args.project, ESettingsLayer.Project)
    layerReads = { user: user.document, project: project?.document }

    const layers: SettingsLayerInput[] = [user.input]
    if (project !== undefined) layers.push(project.input)
    if (args.environment !== undefined) layers.push(args.environment)

    const problems: string[] = []
    if (user.problem !== undefined) problems.push(user.problem)
    if (project?.problem !== undefined) problems.push(project.problem)

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
      serialiseSettingsDocument(nextProject) === serialiseSettingsDocument(priorProject) &&
      JSON.stringify(next.problems) === JSON.stringify(snapshot.problems)
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

  function targetFor(id: string): WriteTarget | undefined {
    const definition = definitions.find((candidate) => candidate.id === id)
    if (definition?.writeLayer !== ESettingsLayer.Project) return userTarget()
    if (args.project === undefined) return undefined
    return { store: args.project, cached: () => layerReads.project ?? EMPTY_SETTINGS_DOCUMENT }
  }

  function userTarget(): WriteTarget {
    return { store: args.user, cached: () => layerReads.user }
  }

  function freshDocument(target: WriteTarget): SettingsDocument {
    try {
      const read = target.store.read()
      if (read.problem !== undefined) return target.cached()
      return read.document
    } catch {
      return target.cached()
    }
  }

  function persist(args: {
    target: WriteTarget
    change: (document: SettingsDocument) => SettingsDocument
  }): SettingsWrite {
    try {
      args.target.store.write(args.change(freshDocument(args.target)))
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }

    armWatcher()
    republish()
    return { ok: true }
  }

  function persistSetting(args: {
    id: string
    change: (document: SettingsDocument) => SettingsDocument
  }): SettingsWrite {
    const target = targetFor(args.id)
    if (target === undefined) {
      return {
        ok: false,
        message: `${args.id} is saved per repository, but this session has no project settings file`,
      }
    }
    return persist({ target, change: args.change })
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
    set: ({ id, value }) =>
      persistSetting({ id, change: (document) => withSetting({ document, id, value }) }),
    clear: ({ id }) =>
      persistSetting({ id, change: (document) => withoutSetting({ document, id }) }),
    writeOrigin: (id) => targetFor(id)?.store.origin(),
    applyUserDocument: (document) => {
      const parsed = parseSettingsDocument(document.values)
      const unchanged =
        serialiseSettingsDocument(parsed) === serialiseSettingsDocument(snapshot.document)
      if (unchanged) return { ok: true }
      return persist({ target: userTarget(), change: () => parsed })
    },
    register: (extra) => {
      const known = new Set(definitions.map((definition) => definition.id))
      const novel = extra.filter((definition) => !known.has(definition.id))
      if (novel.length === 0) return
      definitions = [...definitions, ...novel]
      republish()
    },
    reload: republish,
    close: () => {
      watcher?.close()
      watcher = undefined
    },
  }
}
