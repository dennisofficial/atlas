import { EAccessScope } from '@dltech/atlas-wire/web'

import type { GrantView } from '../../config/cloud-config-grants'
import type {
  CloudConfigClient,
  McpServerWrite,
  ProjectCloudConfigClient,
} from '../../config/cloud-config-store'

type SecretRow = { value: string; grant: string }

type MountRow = { contents: string; mode: number; grant: string }

export type FakeConfigState = {
  settings: Map<string, string>
  secrets: Map<string, SecretRow>
  mounts: Map<string, MountRow>
  grants: Map<string, string>
}

const stateOf = (): FakeConfigState => ({
  settings: new Map(),
  secrets: new Map(),
  mounts: new Map(),
  grants: new Map(),
})

const grantOf = (args: {
  state: FakeConfigState
  grant: string | undefined
  existing: { grant: string } | undefined
  member: 'secret' | 'file'
}): string => {
  if (args.grant !== undefined) {
    if (!args.state.grants.has(args.grant)) {
      throw new Error(`no grant named ${args.grant}; create it with kind grant`)
    }
    return args.grant
  }
  if (args.existing !== undefined) return args.existing.grant
  throw new Error(`name the grant this ${args.member} belongs to (grant: ...)`)
}

const grantViewsOf = (state: FakeConfigState): readonly GrantView[] =>
  [...state.grants.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, instruction]) => ({
      name,
      instruction,
      secrets: [...state.secrets.entries()]
        .filter(([, row]) => row.grant === name)
        .map(([secretName]) => secretName)
        .sort(),
      files: [...state.mounts.entries()]
        .filter(([, row]) => row.grant === name)
        .map(([path, row]) => ({ path, mode: row.mode }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }))

const configOf = (state: FakeConfigState): CloudConfigClient => ({
  scope: EAccessScope.Personal,
  listSettings: async () =>
    [...state.settings.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value })),
  readSetting: async (key) => {
    const value = state.settings.get(key)
    return value === undefined ? null : { key, value }
  },
  setSetting: async ({ key, stored }) => {
    state.settings.set(key, stored)
  },
  removeSetting: async (key) => state.settings.delete(key),
  listSecrets: async () =>
    [...state.secrets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, row]) => ({ name, grant: row.grant })),
  setSecret: async ({ name, value, grant }) => {
    const existing = state.secrets.get(name)
    const granted = grantOf({ state, grant, existing, member: 'secret' })
    state.secrets.set(name, { value, grant: granted })
  },
  removeSecret: async (name) => state.secrets.delete(name),
  listFileMounts: async () =>
    [...state.mounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, row]) => ({ path, mode: row.mode, grant: row.grant })),
  setFileMount: async ({ path, contents, mode, grant }) => {
    const existing = state.mounts.get(path)
    const granted = grantOf({ state, grant, existing, member: 'file' })
    state.mounts.set(path, { contents, mode, grant: granted })
  },
  removeFileMount: async (path) => state.mounts.delete(path),
  listGrants: async () => grantViewsOf(state),
  readGrant: async (name) => grantViewsOf(state).find((grant) => grant.name === name) ?? null,
  setGrant: async ({ name, instruction, newName }) => {
    if (newName !== undefined) {
      if (!state.grants.has(name))
        throw new Error(`no grant named ${name}; create it with kind grant`)
      if (state.grants.has(newName)) throw new Error(`a grant named ${newName} already exists`)
      const kept = state.grants.get(name) ?? ''
      state.grants.delete(name)
      state.grants.set(newName, instruction ?? kept)
      for (const row of state.secrets.values()) if (row.grant === name) row.grant = newName
      for (const row of state.mounts.values()) if (row.grant === name) row.grant = newName
      return
    }
    state.grants.set(name, instruction ?? state.grants.get(name) ?? '')
  },
  removeGrant: async (name) => {
    if (!state.grants.delete(name)) return false
    for (const [secretName, row] of [...state.secrets.entries()]) {
      if (row.grant === name) state.secrets.delete(secretName)
    }
    for (const [path, row] of [...state.mounts.entries()]) {
      if (row.grant === name) state.mounts.delete(path)
    }
    return true
  },
})

export type FakePersonalConfig = { client: CloudConfigClient; state: FakeConfigState }

export const fakePersonalConfig = (): FakePersonalConfig => {
  const state = stateOf()
  return { client: { ...configOf(state) }, state }
}

export type FakeCloudConfig = {
  client: ProjectCloudConfigClient
  settings: Map<string, string>
  secrets: Map<string, SecretRow>
  servers: Map<string, McpServerWrite>
  mounts: Map<string, MountRow>
  grants: Map<string, string>
}

export const fakeCloudConfig = (args: { projectId?: string } = {}): FakeCloudConfig => {
  const state = stateOf()
  const servers = new Map<string, McpServerWrite>()
  const base = configOf(state)
  const client: ProjectCloudConfigClient = {
    ...base,
    scope: EAccessScope.Project,
    projectId: args.projectId ?? 'prj_1',
    listMcpServers: async () =>
      [...servers.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((server) => ({
          name: server.name,
          transport: server.transport,
          disabled: server.disabled,
          proxy: server.proxy === true,
        })),
    readMcpServer: async (name) => {
      const server = servers.get(name)
      return server === undefined
        ? null
        : {
            name: server.name,
            transport: server.transport,
            disabled: server.disabled,
            proxy: server.proxy === true,
          }
    },
    putMcpServer: async (server) => {
      servers.set(server.name, server)
    },
    removeMcpServer: async (name) => servers.delete(name),
  }
  return {
    client,
    settings: state.settings,
    secrets: state.secrets,
    servers,
    mounts: state.mounts,
    grants: state.grants,
  }
}
