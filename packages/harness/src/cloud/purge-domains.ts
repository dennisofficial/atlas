import type { CloudPurgeResult } from './download-purge'

export type CloudPurgeDomainId = 'accounts' | 'secrets' | 'mcpServers' | 'memory' | 'github'

export type CloudPurgeDomain = {
  id: CloudPurgeDomainId
  /** Names the step when a mid-purge failure message says which one broke. */
  step: string
  /** The confirm drawer's one-line description of what happens to it. */
  drawerLabel: string
} & (
  | {
      count: (result: CloudPurgeResult) => number
      /** The phrase the count lands as in the moved list of a success notice. */
      movedLabel: (count: number) => string
    }
  | { count?: undefined; movedLabel?: undefined }
)

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

export const CLOUD_PURGE_DOMAINS: readonly CloudPurgeDomain[] = [
  {
    id: 'accounts',
    step: 'accounts',
    drawerLabel: 'model accounts and their credentials',
    count: (result) => result.accounts,
    movedLabel: (count) => plural(count, 'account'),
  },
  {
    id: 'secrets',
    step: 'secrets',
    drawerLabel: 'secrets',
    count: (result) => result.secrets,
    movedLabel: (count) => plural(count, 'secret'),
  },
  {
    id: 'mcpServers',
    step: 'mcp servers',
    drawerLabel: 'MCP servers',
    count: (result) => result.mcpServers,
    movedLabel: (count) => plural(count, 'MCP server'),
  },
  {
    id: 'memory',
    step: 'memory',
    drawerLabel: 'your memory',
    count: (result) => result.memoryFiles,
    movedLabel: () => 'your memory',
  },
  {
    id: 'github',
    step: 'github connection',
    drawerLabel: 'your GitHub connection (deleted, not moved)',
  },
]
