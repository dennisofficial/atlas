import { describe, expect, it } from 'bun:test'

import {
  channelSignalSchema,
  EClientRequest,
  readSessionFilesParamsSchema,
  readSessionFilesReplySchema,
  sessionManifestReplySchema,
} from '../index'

const sha = 'a'.repeat(64)

describe('the session-mirror wire contract', () => {
  it('names the manifest and file-read ops', () => {
    expect(EClientRequest.ReadSessionManifest).toBe('read-session-manifest')
    expect(EClientRequest.ReadSessionFiles).toBe('read-session-files')
  })

  it('carries a revisioned manifest of hashed files', () => {
    const reply = sessionManifestReplySchema.parse({
      revision: 7,
      files: [
        { path: 'meta.json', bytes: 210, sha256: sha },
        { path: 'threads/thr_123.meta.json', bytes: 88, sha256: sha },
      ],
    })

    expect(reply.revision).toBe(7)
    expect(reply.files).toHaveLength(2)
  })

  it('refuses a manifest entry without a full sha256', () => {
    const parsed = sessionManifestReplySchema.safeParse({
      revision: 1,
      files: [{ path: 'meta.json', bytes: 1, sha256: 'abc' }],
    })

    expect(parsed.success).toBe(false)
  })

  it('bounds a file-read request to a non-empty batch', () => {
    expect(readSessionFilesParamsSchema.safeParse({ paths: [] }).success).toBe(false)
    expect(readSessionFilesParamsSchema.safeParse({ paths: ['meta.json'] }).success).toBe(true)
  })

  it('answers reads with contents and the paths it could not produce', () => {
    const reply = readSessionFilesReplySchema.parse({
      revision: 7,
      files: [{ path: 'context/plan.md', encoding: 'utf8', content: '# plan' }],
      missing: ['context/gone.md'],
    })

    expect(reply.files[0]?.content).toBe('# plan')
    expect(reply.missing).toEqual(['context/gone.md'])
  })

  it('pushes a revisioned session-files-changed signal', () => {
    const signal = channelSignalSchema.parse({ type: 'session-files-changed', revision: 12 })

    expect(signal).toEqual({ type: 'session-files-changed', revision: 12 })
  })
})
