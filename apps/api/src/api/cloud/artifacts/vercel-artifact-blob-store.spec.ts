import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { hoisted } from '@dltech/bun-test-shims'
import type { EnvService } from '../../../_core/config/env/env.service'

const sdk = hoisted(() => ({
  issueCalls: [] as Record<string, unknown>[],
  presignCalls: [] as Record<string, unknown>[],
}))

mock.module('@vercel/blob', () => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
  del: async () => undefined,
  head: async () => ({ url: '', size: 0 }),
  list: async () => ({ blobs: [], hasMore: false }),
  put: async () => ({ url: '' }),
  issueSignedToken: async (options: Record<string, unknown>) => {
    sdk.issueCalls.push(options)
    return 'delegation-token'
  },
  presignUrl: async (_delegation: string, options: Record<string, unknown>) => {
    sdk.presignCalls.push(options)
    return { presignedUrl: 'https://blob.test/artifacts/at-1/_source/index.html' }
  },
}))

import { VercelArtifactBlobStore } from './vercel-artifact-blob-store'

const SOURCE_KEY = 'artifacts/at-1/_source/index.html'

const MAX_BYTES = 25 * 1024 * 1024

const storeOf = (): VercelArtifactBlobStore =>
  new VercelArtifactBlobStore({
    get: () => 'vercel_blob_rw_test-store_test-secret',
  } as unknown as EnvService)

describe('VercelArtifactBlobStore.presignUpload', () => {
  beforeEach(() => {
    sdk.issueCalls.length = 0
    sdk.presignCalls.length = 0
  })

  it('answers the upload url the store signs', async () => {
    const upload = await storeOf().presignUpload({ pathname: SOURCE_KEY, maxBytes: MAX_BYTES })

    expect(upload.url).toBe('https://blob.test/artifacts/at-1/_source/index.html')
    expect(upload.validUntil).toBeGreaterThan(Date.now())
  })

  it('caps the upload by size without pinning a content type', async () => {
    await storeOf().presignUpload({ pathname: SOURCE_KEY, maxBytes: MAX_BYTES })

    for (const call of [...sdk.issueCalls, ...sdk.presignCalls]) {
      expect(call.pathname).toBe(SOURCE_KEY)
      expect(call.maximumSizeInBytes).toBe(MAX_BYTES)
      expect(call.allowedContentTypes).toBeUndefined()
    }
  })

  it('signs a put for public bytes that may overwrite the previous version', async () => {
    await storeOf().presignUpload({ pathname: SOURCE_KEY, maxBytes: MAX_BYTES })

    expect(sdk.issueCalls[0]).toMatchObject({ operations: ['put'] })
    expect(sdk.presignCalls[0]).toMatchObject({
      operation: 'put',
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  })
})
