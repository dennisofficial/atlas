import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EAuthKind, EAuthProvider, toAccountId, type OauthCredential } from '@dltech/atlas-core'

import { CODEX_VERSION, CodexModelsCatalogue } from '../../models'
import { atlasDirectory } from '../../store/paths'
import { codexModelsFsPorts } from '../codex-models-fs-ports'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-codex-ports-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const credential = (providerAccountId?: string): OauthCredential => ({
  kind: EAuthKind.Oauth,
  accountId: toAccountId('acc_1'),
  accessToken: 'tok-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  ...(providerAccountId === undefined ? {} : { providerAccountId }),
})

describe('codexModelsFsPorts', () => {
  it('reads nothing before the first write, then round-trips through the file', async () => {
    const cacheFile = join(directory, 'nested', 'codex-models-cache.json')
    const { cache } = codexModelsFsPorts({ cacheFile })

    expect(cache.read()).toBeUndefined()

    await cache.write('{"a":1}')

    expect(cache.read()).toBe('{"a":1}')
    expect(await readFile(cacheFile, 'utf8')).toBe('{"a":1}')
  })

  it('defaults the cache file to codex-models-cache.json in the atlas directory', () => {
    expect(codexModelsFsPorts().cacheFile).toBe(join(atlasDirectory(), 'codex-models-cache.json'))
  })

  it('hashes providerAccountId, falling back to the Atlas account id, with sha256 hex', async () => {
    const { identityOf } = codexModelsFsPorts({ cacheFile: join(directory, 'c.json') })

    expect(await identityOf(credential('chatgpt-acct-1'))).toBe(
      createHash('sha256').update('chatgpt-acct-1').digest('hex'),
    )
    expect(await identityOf(credential())).toBe(createHash('sha256').update('acc_1').digest('hex'))
  })

  it('stamps now as an ISO timestamp', () => {
    const { now } = codexModelsFsPorts({ cacheFile: join(directory, 'c.json') })
    const stamp = now()
    expect(new Date(stamp).toISOString()).toBe(stamp)
  })

  it('persists the same entry JSON shape the catalogue always wrote', async () => {
    const cacheFile = join(directory, 'codex-models-cache.json')
    const catalogue = new CodexModelsCatalogue({
      credentials: { read: async () => credential('chatgpt-acct-1'), discard: async () => {} },
      provider: EAuthProvider.OpenAI,
      clientVersion: CODEX_VERSION,
      ports: {
        ...codexModelsFsPorts({ cacheFile }),
        fetch: async () =>
          new Response(
            JSON.stringify({ models: [{ slug: 'a', visibility: 'list', priority: 1 }] }),
            { headers: { etag: '"v1"' } },
          ),
      },
    })

    await catalogue.refresh()

    const onDisk = JSON.parse(await readFile(cacheFile, 'utf8'))
    expect(Object.keys(onDisk).sort()).toEqual(['cards', 'etag', 'fetchedAt', 'identity'])
    expect(onDisk.identity).toBe(createHash('sha256').update('chatgpt-acct-1').digest('hex'))
    expect(onDisk.etag).toBe('"v1"')
    expect(onDisk.cards[0].ref).toEqual({ providerId: 'openai', modelId: 'a' })
  })
})
