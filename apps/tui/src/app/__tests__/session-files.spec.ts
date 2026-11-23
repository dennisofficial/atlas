import { describe, expect, test } from 'bun:test'

import { sessionFilesOf } from '../session-files'
import type { SessionApi } from '../session-api'

const apiOf = (args: {
  trees: {
    directory: string
    entries: { name: string; isDirectory: boolean; changed: boolean }[]
  }[]
  paths: string[]
}): SessionApi =>
  ({
    treeFiles: async () => args.trees.shift() ?? { directory: '', entries: [] },
    searchFiles: async () => ({
      paths: args.paths.map((path) => ({ path, positions: [] })),
      truncated: false,
    }),
  }) as unknown as SessionApi

describe('sessionFilesOf', () => {
  test('lists a directory and maps the entries to name and kind only', async () => {
    const asked: { sessionId: string; directory: string }[] = []
    const api = {
      treeFiles: async (input: { sessionId: string; directory: string }) => {
        asked.push(input)
        return {
          directory: input.directory,
          entries: [
            { name: 'src', isDirectory: true, changed: true },
            { name: 'README.md', isDirectory: false, changed: false },
          ],
        }
      },
    } as unknown as SessionApi

    const files = sessionFilesOf({ api, sessionId: 'session-1' })
    const entries = await files.list('.')

    expect(asked).toEqual([{ sessionId: 'session-1', directory: '.' }])
    expect(entries).toEqual([
      { name: 'src', isDirectory: true },
      { name: 'README.md', isDirectory: false },
    ])
  })

  test('search returns paths capped at the limit', async () => {
    const api = apiOf({ trees: [], paths: ['a.ts', 'b.ts', 'c.ts'] })
    const files = sessionFilesOf({ api, sessionId: 'session-1' })

    expect(await files.search({ query: 'ts', limit: 2 })).toEqual(['a.ts', 'b.ts'])
  })
})
