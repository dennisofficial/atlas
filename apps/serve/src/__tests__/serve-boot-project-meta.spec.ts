import { afterEach, describe, expect, it } from 'bun:test'

import { ATLAS_HOME_ENV } from '@dltech/atlas-core'

import {
  readMetaSync,
  sessionDirectory,
  threadMetaFile,
  threadMetaSchema,
} from '@dltech/atlas-harness'

import { fakeServeApp } from './fakes'
import { releaseServeSpec, start, startWithHomeSpec, threadId } from './serve-spec-fixture'
import { trpcOk } from './trpc-fake'

afterEach(releaseServeSpec)

const bornProjectId = () => {
  const home = process.env[ATLAS_HOME_ENV] ?? ''
  const file = threadMetaFile({
    sessionDir: sessionDirectory({ home, sessionId: threadId }),
    threadId,
  })
  return readMetaSync({ file, schema: threadMetaSchema })?.projectId
}

describe('startServe born thread meta project', () => {
  it('records the bootstrap project so the session mirror does not null it', async () => {
    await startWithHomeSpec({
      spec: { projectId: 'proj-boot' },
      fetchFn: (async (_input: unknown) =>
        trpcOk({
          projectId: 'proj-boot',
          repo: null,
          baseBranch: null,
          additionalRepos: [],
          githubToken: null,
        })) as typeof fetch,
      compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
    })

    expect(bornProjectId()).toBe('proj-boot')
  })

  it('leaves the project null when the bootstrap names none', async () => {
    await start({})

    expect(bornProjectId()).toBeNull()
  })
})
