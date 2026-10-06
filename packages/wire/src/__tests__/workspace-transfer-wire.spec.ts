import { describe, expect, it } from 'bun:test'

import { prepareWorkspaceArchiveReplySchema } from '../workspace-transfer-wire'

const reply = {
  path: '/atlas/home/exports/workspace-abc.tar.gz',
  manifest: {
    version: 1,
    repository: null,
    activeId: 'main',
    trees: [
      {
        id: 'main',
        name: 'main',
        sourcePath: '/atlas/workspace',
        originPath: '/atlas/workspace',
        branch: null,
        head: null,
        baseline: null,
        fingerprint: 'f',
        isMain: true,
      },
    ],
  },
}

describe('the prepare reply', () => {
  it('parses a reply from a serve that predates totalBytes', () => {
    expect(prepareWorkspaceArchiveReplySchema.parse(reply).totalBytes).toBeUndefined()
  })

  it('carries a non-negative integer total', () => {
    expect(prepareWorkspaceArchiveReplySchema.parse({ ...reply, totalBytes: 0 }).totalBytes).toBe(0)
    expect(prepareWorkspaceArchiveReplySchema.parse({ ...reply, totalBytes: 2048 }).totalBytes).toBe(2048)
  })

  it('rejects negative and fractional totals', () => {
    expect(prepareWorkspaceArchiveReplySchema.safeParse({ ...reply, totalBytes: -1 }).success).toBe(false)
    expect(prepareWorkspaceArchiveReplySchema.safeParse({ ...reply, totalBytes: 1.5 }).success).toBe(false)
  })
})
