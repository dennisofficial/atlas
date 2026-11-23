import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { ContextContentStore } from '@dltech/atlas-control'
import { EnvService } from '../../_core/config/env/env.service'
import {
  contextContentStoreOf,
  S3ContextContentStore,
  UnavailableContextContentStore,
} from './context-content.provider'

const HASH = 'ab'.padEnd(64, '0')

const envOf = (values: Record<string, string>): EnvService => new EnvService(values)

const fullEnv = {
  ARTIFACT_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  ARTIFACT_S3_REGION: 'auto',
  ARTIFACT_S3_BUCKET: 'atlas-artifacts',
  ARTIFACT_S3_ACCESS_KEY_ID: 'key',
  ARTIFACT_S3_SECRET_ACCESS_KEY: 'secret',
}

const storeOf = (env: EnvService): ContextContentStore => contextContentStoreOf(env)

describe('S3ContextContentStore', () => {
  it('reports missing context storage as a service unavailable error', async () => {
    const store = new S3ContextContentStore({
      env: envOf({ ARTIFACT_S3_ENDPOINT: fullEnv.ARTIFACT_S3_ENDPOINT }),
    })

    const failed = store.put({ hash: HASH, bytes: new Uint8Array() })

    await expect(failed).rejects.toThrow(ServiceUnavailableException)
    await expect(failed).rejects.toThrow('change storage is missing CHANGES_S3_BUCKET')
  })
})

describe('UnavailableContextContentStore', () => {
  it('answers 503 for every read and write', async () => {
    const store: ContextContentStore = new UnavailableContextContentStore()

    expect(() => store.put({ hash: HASH, bytes: new Uint8Array() })).toThrow(
      'context storage is not configured',
    )
    expect(() => store.list()).toThrow(ServiceUnavailableException)
  })
})

describe('contextContentStoreProvider', () => {
  it('builds the S3 store when the tier names a bucket', () => {
    expect(storeOf(envOf(fullEnv))).toBeInstanceOf(S3ContextContentStore)
  })

  it('falls back to the unavailable store when no bucket is configured', () => {
    expect(storeOf(envOf({}))).toBeInstanceOf(UnavailableContextContentStore)
  })
})
