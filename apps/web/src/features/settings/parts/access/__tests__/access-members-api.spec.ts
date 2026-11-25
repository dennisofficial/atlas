import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EAccessScope } from '@dltech/atlas-wire/web'

import { answerTrpc, resetTrpc, restoreTrpc, trpcCalls, trpcData } from '@/lib/__tests__/fake-trpc'

import { accessMemberApiOf } from '../access-members-api'

const personal = accessMemberApiOf({ kind: EAccessScope.Personal })
const project = accessMemberApiOf({ kind: EAccessScope.Project, projectId: 'prj_1' })

beforeEach(resetTrpc)
afterEach(restoreTrpc)

describe('personal members', () => {
  it('sets a secret into a grant', async () => {
    await personal.setSecret({ grantId: 'g1', name: 'API_KEY', value: 'v' })
    expect(trpcCalls).toEqual([
      {
        url: '/v1/trpc/secrets.set',
        method: 'POST',
        body: { name: 'API_KEY', value: 'v', grantId: 'g1' },
      },
    ])
  })

  it('omits the grant for a quick add', async () => {
    await personal.setSecret({ name: 'API_KEY', value: 'v' })
    expect(trpcCalls[0]?.body).toEqual({ name: 'API_KEY', value: 'v' })
  })

  it('reveals a secret by name', async () => {
    answerTrpc(() => trpcData({ value: 'hunter2' }))
    expect(await personal.revealSecret('API_KEY')).toBe('hunter2')
    expect(trpcCalls[0]?.url).toContain('/v1/trpc/secrets.reveal')
  })

  it('writes a file mount that starts at the home folder', async () => {
    await personal.setFile({ grantId: 'g1', path: '~/x', contents: 'c', mode: 384 })
    expect(trpcCalls).toEqual([
      {
        url: '/v1/trpc/personalFileMounts.set',
        method: 'POST',
        body: { path: '~/x', contents: 'c', mode: 384, grantId: 'g1' },
      },
    ])
  })

  it('reveals a personal file', async () => {
    answerTrpc(() => trpcData({ contents: 'secret' }))
    expect(await personal.revealFile('~/x')).toBe('secret')
    expect(trpcCalls[0]?.url).toContain('/v1/trpc/personalFileMounts.reveal')
  })

  it('removes by name and by path', async () => {
    await personal.removeSecret('API_KEY')
    await personal.removeFile('~/x')
    expect(trpcCalls.map((call) => call.url)).toEqual([
      '/v1/trpc/secrets.remove',
      '/v1/trpc/personalFileMounts.remove',
    ])
  })
})

describe('project members', () => {
  it('carries the project id on every call', async () => {
    await project.setSecret({ grantId: 'g1', name: 'API_KEY', value: 'v' })
    await project.removeSecret('API_KEY')
    expect(trpcCalls[0]?.body).toEqual({
      projectId: 'prj_1',
      name: 'API_KEY',
      value: 'v',
      grantId: 'g1',
    })
    expect(trpcCalls[1]?.url).toBe('/v1/trpc/projectResources.removeSecret')
  })

  it('writes a repository file mount', async () => {
    await project.setFile({ path: '.env.local', contents: 'c', mode: 384 })
    expect(trpcCalls[0]?.url).toBe('/v1/trpc/projectResources.setFileMount')
    expect(trpcCalls[0]?.body).toEqual({
      projectId: 'prj_1',
      path: '.env.local',
      contents: 'c',
      mode: 384,
    })
  })

  it('reveals a project file', async () => {
    answerTrpc(() => trpcData({ contents: 'x' }))
    expect(await project.revealFile('.env.local')).toBe('x')
    expect(trpcCalls[0]?.url).toContain('/v1/trpc/projectResources.revealFileMount')
  })
})
