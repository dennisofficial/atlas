import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createPersonalApp, trpcMutate, trpcQuery } from '../personal-resources.router.fixture'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { HarnessSecretsRouter } from './harness-secrets.router'
import { HarnessSecretsService } from './harness-secrets.service'

describe('HarnessSecretsRouter', () => {
  useTestDatabase()
  const rows = () => db.orm.public.UserHarnessSecret.where((row) => row.id.neq('')).all()
  let app: INestApplication
  const set = (token: string | undefined, input: object) =>
    trpcMutate({ app, procedure: 'harnessSecrets.set', token, input })
  const remove = (token: string | undefined, name: string) =>
    trpcMutate({ app, procedure: 'harnessSecrets.remove', token, input: { name } })
  const query = (procedure: string, token?: string) =>
    trpcQuery({ app, procedure: `harnessSecrets.${procedure}`, token })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await createPersonalApp([HarnessSecretsRouter, HarnessSecretsService])
  })

  afterEach(() => app.close())

  it('sets, lists with values, names and removes', async () => {
    await set('session-a', { name: 'search.tavily', value: 'tvly-1' }).expect(200)
    await set('session-a', { name: 'decisions.token.openai', value: 'sk-1' }).expect(200)
    await set('session-a', { name: 'search.tavily', value: 'tvly-2' }).expect(200)

    expect((await rows())[0]?.id).toMatch(/^hsec_/)
    const list = await query('list', 'session-a').expect(200)
    expect(list.headers['cache-control']).toBe('no-store')
    expect(
      list.body.result.data.secrets.map((s: { name: string; value: string }) => [s.name, s.value]),
    ).toEqual([
      ['decisions.token.openai', 'sk-1'],
      ['search.tavily', 'tvly-2'],
    ])
    const names = await query('names', 'session-a').expect(200)
    expect(names.body.result.data).toEqual({ names: ['decisions.token.openai', 'search.tavily'] })
    expect(names.text).not.toContain('tvly')

    await remove('session-a', 'search.tavily').expect(200)
    expect(await rows()).toHaveLength(1)
  })

  it('rejects env names and local-only prefixes', async () => {
    await set('session-a', { name: 'OPENAI_KEY', value: 'x' }).expect(400)
    await set('session-a', { name: 'sandbox-serve:thr-1', value: 'x' }).expect(400)
    await set('session-a', { name: 'mcp-oauth:https://x', value: 'x' }).expect(400)
    await set('session-a', { name: 'n.'.repeat(101), value: 'x' }).expect(400)
    await set('session-a', { name: 'search.x', value: 'x', bogus: true }).expect(400)
    expect(await rows()).toHaveLength(0)
  })

  it('isolates users', async () => {
    await set('session-a', { name: 'search.jina', value: 'a' }).expect(200)
    await set('session-b', { name: 'search.jina', value: 'b' }).expect(200)
    await remove('session-b', 'search.jina').expect(200)

    const list = await query('list', 'session-a').expect(200)
    expect(list.body.result.data.secrets).toHaveLength(1)
    expect(list.body.result.data.secrets[0].value).toBe('a')
    const other = await query('list', 'session-b').expect(200)
    expect(other.body.result.data.secrets).toEqual([])
  })

  it('lets a pod or sandbox read list but not names or writes', async () => {
    await set('session-a', { name: 'search.jina', value: 'a' }).expect(200)

    const pod = await query('list', 'pod-token-a').expect(200)
    expect(pod.body.result.data.secrets).toHaveLength(1)
    await query('list', 'sandbox-token-a').expect(200)
    await query('list').expect(401)
    await query('names', 'pod-token-a').expect(401)
    await set('pod-token-a', { name: 'search.x', value: 'x' }).expect(401)
    await remove('pod-token-a', 'search.jina').expect(401)
    expect(await rows()).toHaveLength(1)
  })
})
