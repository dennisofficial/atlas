import type { CloudConfigClient, McpServerWrite } from '../../config/cloud-config-store'

export type FakeCloudConfig = {
  client: CloudConfigClient
  settings: Map<string, string>
  secrets: Map<string, string>
  servers: Map<string, McpServerWrite>
  mounts: Map<string, { contents: string; mode: number }>
}

export const fakeCloudConfig = (args: { projectId?: string } = {}): FakeCloudConfig => {
  const settings = new Map<string, string>()
  const secrets = new Map<string, string>()
  const servers = new Map<string, McpServerWrite>()
  const mounts = new Map<string, { contents: string; mode: number }>()

  const client: CloudConfigClient = {
    projectId: args.projectId ?? 'prj_1',
    listSettings: async () =>
      [...settings.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({ key, value })),
    readSetting: async (key) => {
      const value = settings.get(key)
      return value === undefined ? null : { key, value }
    },
    setSetting: async ({ key, stored }) => {
      settings.set(key, stored)
    },
    removeSetting: async (key) => settings.delete(key),
    listSecretNames: async () => [...secrets.keys()].sort(),
    setSecret: async ({ name, value }) => {
      secrets.set(name, value)
    },
    removeSecret: async (name) => secrets.delete(name),
    listMcpServers: async () =>
      [...servers.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((server) => ({
          name: server.name,
          transport: server.transport,
          disabled: server.disabled,
        })),
    readMcpServer: async (name) => {
      const server = servers.get(name)
      return server === undefined
        ? null
        : { name: server.name, transport: server.transport, disabled: server.disabled }
    },
    putMcpServer: async (server) => {
      servers.set(server.name, server)
    },
    removeMcpServer: async (name) => servers.delete(name),
    listFileMounts: async () =>
      [...mounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, row]) => ({ path, mode: row.mode })),
    setFileMount: async ({ path, contents, mode }) => {
      mounts.set(path, { contents, mode })
    },
    removeFileMount: async (path) => mounts.delete(path),
  }

  return { client, settings, secrets, servers, mounts }
}
