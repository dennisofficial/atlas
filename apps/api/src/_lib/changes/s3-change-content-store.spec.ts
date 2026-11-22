import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { EnvService } from '../../_core/config/env/env.service'
import { S3ChangeContentStore } from './s3-change-content-store'

const HASH = 'ab'.padEnd(64, '0')

const envOf = (values: Record<string, string>): EnvService => new EnvService(values)

describe('S3ChangeContentStore', () => {
  it('reports missing change storage as a service unavailable error', async () => {
    const store = new S3ChangeContentStore({
      env: envOf({
        ARTIFACT_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
        ARTIFACT_S3_REGION: 'auto',
        ARTIFACT_S3_BUCKET: 'atlas-artifacts',
        ARTIFACT_S3_ACCESS_KEY_ID: 'key',
      }),
    })

    const failed = store.put({ hash: HASH, bytes: new Uint8Array() })

    await expect(failed).rejects.toThrow(ServiceUnavailableException)
    await expect(failed).rejects.toThrow('change storage is missing ARTIFACT_S3_SECRET_ACCESS_KEY')
  })

  it('reports a missing bucket as a service unavailable error', async () => {
    const store = new S3ChangeContentStore({ env: envOf({}) })

    await expect(store.list()).rejects.toThrow(ServiceUnavailableException)
    await expect(store.list()).rejects.toThrow('change storage is missing CHANGES_S3_BUCKET')
  })
})
