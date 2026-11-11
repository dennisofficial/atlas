import type { INestApplication } from '@nestjs/common'
import { MAX_BYTES_PER_USER, MAX_BYTES_PER_VERSION } from '@dltech/atlas-artifacts'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { trpcMutation } from '../session-trpc-test-app'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { ArtifactRetention } from './artifact-retention'
import { buildArtifactsApp, OWNER } from './artifacts.router.fixture'

const fullVersion = {
  path: 'index.html',
  tree: 'src' as const,
  sha256: 'c'.repeat(64),
  size: MAX_BYTES_PER_VERSION,
  type: 'text/html',
}

const versionsThatFit = Math.floor(MAX_BYTES_PER_USER / MAX_BYTES_PER_VERSION)

describe('ArtifactsRouter per-user ceiling', () => {
  useTestDatabase()
  let app: INestApplication
  const blobs = new FakeArtifactBlobStore()
  const retention = new ArtifactRetention(blobs)

  const begin = (name: string) =>
    trpcMutation({
      app,
      path: 'artifacts.beginPublish',
      token: OWNER,
      input: { name, entries: [fullVersion] },
    })

  beforeEach(async () => {
    await seedSessionUsers()
    blobs.reset()
    app = await buildArtifactsApp({ blobs, retention })
  })

  afterEach(() => app.close())

  it('accepts every version up to the ceiling and refuses the one past it', async () => {
    for (let index = 0; index < versionsThatFit; index++) {
      await begin(`bulk-${index}`).expect(200)
    }
    await begin('one-too-many').expect(400)
  })
})
