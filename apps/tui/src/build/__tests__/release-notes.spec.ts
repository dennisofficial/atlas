import { describe, expect, it, mock } from 'bun:test'

import { fetchReleaseNotes } from '../release-notes'

const realFetch = globalThis.fetch

describe('fetchReleaseNotes', () => {
  it('returns cleaned bodies: change lines only, no links or full-changelog scaffolding', async () => {
    const body = [
      "## What's Changed",
      '',
      '* fix(cloud): capture only the active worktree by @dennisofficial in https://github.com/owner/atlas/pull/975',
      '',
      '**Full Changelog**: https://github.com/owner/atlas/compare/tui-v1.46.1...tui-v1.46.2',
    ].join('\n')

    globalThis.fetch = mock(async () =>
      Response.json([{ tag_name: 'tui-v1.46.2', body }])
    ) as unknown as typeof fetch

    try {
      const result = await fetchReleaseNotes({
        repo: 'owner/atlas',
        prefix: 'tui-v',
        sinceVersion: '1.46.0',
        upToVersion: '1.46.2',
      })

      expect(result).toEqual({
        kind: 'ok',
        rows: [{ version: '1.46.2', body: '* fix(cloud): capture only the active worktree' }],
      })
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
