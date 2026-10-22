import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import { VercelBundleBlobStore } from './vercel-bundle-blob-store'

describe('VercelBundleBlobStore without a token', () => {
  const store = new VercelBundleBlobStore(new EnvService({}))
  const pathname = 'bundles/user-a/x.tar.gz'

  it('answers service unavailable on every operation', async () => {
    await expect(store.presignUpload({ pathname })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    await expect(store.head({ pathname })).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(store.presignDownload({ pathname })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
