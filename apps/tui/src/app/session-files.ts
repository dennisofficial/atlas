import type { DirectoryEntry } from '@dltech/atlas-core'

import type { SessionApi } from './session-api'

export type MentionListing = {
  list: (directory: string) => Promise<readonly DirectoryEntry[]>
}

export type SessionFiles = MentionListing & {
  search: (args: { query: string; limit: number }) => Promise<readonly string[]>
}

export const NO_SESSION_FILES: SessionFiles = {
  list: async () => [],
  search: async () => [],
}

export const sessionFilesOf = (args: { api: SessionApi; sessionId: string }): SessionFiles => ({
  list: async (directory) => {
    const reply = await args.api.treeFiles({ sessionId: args.sessionId, directory })
    return reply.entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }))
  },
  search: async (searchArgs) => {
    const reply = await args.api.searchFiles({
      sessionId: args.sessionId,
      query: searchArgs.query,
    })
    return reply.paths.map((entry) => entry.path).slice(0, searchArgs.limit)
  },
})
