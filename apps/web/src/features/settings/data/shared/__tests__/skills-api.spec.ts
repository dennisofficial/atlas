import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'
import { ESkillScope } from '@dltech/atlas-wire/web'

import * as realApiClient from '@/lib/api-client'

let calls: { url: string; init?: RequestInit }[]
let reply: () => Response

const fakeFetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return reply()
  },
  { preconnect: fetch.preconnect },
)

mock.module('@/lib/api-client', () => ({
  ...realApiClient,
  api: createApiClient({ baseUrl: '', fetchFn: fakeFetch }),
}))

const {
  getSkillFile,
  isSkillConflict,
  listSkillFiles,
  listSkills,
  putSkillFile,
  removeSkill,
  removeSkillFile,
  saveSkillText,
  fromBase64Utf8,
  sha256HexOfBase64,
  toBase64Utf8,
} = await import('../skills-api')

const ok = (data: unknown): Response => Response.json({ result: { data } })

const conflict = (): Response =>
  Response.json(
    {
      error: {
        message: 'the file changed since baseRevision',
        code: -32603,
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          httpStatus: 409,
          path: 'skills.put',
          details: {
            statusCode: 409,
            message: 'the file changed since baseRevision',
            currentRevision: 3,
          },
        },
      },
    },
    { status: 409 },
  )

beforeEach(() => {
  calls = []
  reply = () => ok({})
})

describe('skills api', () => {
  it('lists skills for the personal scope', async () => {
    reply = () =>
      ok({
        skills: [
          {
            name: 'tdd',
            description: 'red-green-refactor',
            fileCount: 1,
            sizeBytes: 120,
            updatedAt: '2026-11-01T00:00:00Z',
            usage: { usedCount30d: 4, lastUsedAt: '2026-11-02T00:00:00Z' },
          },
        ],
      })
    const skills = await listSkills({ scope: ESkillScope.Personal })
    expect(skills[0]?.usage.usedCount30d).toBe(4)
    expect(calls[0]?.url).toContain('/v1/trpc/skills.list')
  })

  it('scopes project calls by projectId', async () => {
    reply = () => ok({ files: [] })
    await listSkillFiles({ scope: ESkillScope.Project, projectId: 'prj_1', skill: 'atlas' })
    const url = new URL(calls[0]?.url ?? '', 'http://test')
    const sent = JSON.parse(url.searchParams.get('input') ?? '{}')
    expect(sent).toMatchObject({ scope: 'project', projectId: 'prj_1', skill: 'atlas' })
  })

  it('decodes base64 content as utf8', async () => {
    const text = 'héllo — snowman ☃'
    reply = () =>
      ok({
        path: 'SKILL.md',
        revision: 2,
        contentHash: 'h',
        sizeBytes: 100,
        isText: true,
        updatedAt: '2026-11-01T00:00:00Z',
        content: toBase64Utf8(text),
      })
    const file = await getSkillFile({ scope: ESkillScope.Personal, skill: 'tdd', path: 'SKILL.md' })
    expect(fromBase64Utf8(file.content)).toBe(text)
    expect(file.revision).toBe(2)
  })

  it('sends sha256 contentHash and baseRevision on put', async () => {
    const content = toBase64Utf8('hello')
    reply = () => ok({ revision: 7 })
    const revision = await putSkillFile({
      scope: ESkillScope.Personal,
      skill: 'tdd',
      path: 'SKILL.md',
      content,
      contentHash: await sha256HexOfBase64(content),
      baseRevision: 6,
    })
    expect(revision).toBe(7)
    const sent = JSON.parse(String(calls[0]?.init?.body))
    expect(sent).toMatchObject({
      skill: 'tdd',
      path: 'SKILL.md',
      baseRevision: 6,
      contentHash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    })
  })

  it('marks a 409 as a skill conflict', async () => {
    reply = conflict
    const attempt = putSkillFile({
      scope: ESkillScope.Personal,
      skill: 'tdd',
      path: 'SKILL.md',
      content: toBase64Utf8('stale'),
      contentHash: 'x',
      baseRevision: 1,
    })
    const failure = await attempt.catch((error: unknown) => error)
    expect(isSkillConflict(failure)).toBe(true)
  })

  it('does not mark other failures as conflicts', async () => {
    reply = () =>
      Response.json(
        {
          error: {
            message: 'boom',
            code: -32603,
            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'skills.get' },
          },
        },
        { status: 500 },
      )
    const failure = await getSkillFile({
      scope: ESkillScope.Personal,
      skill: 'tdd',
      path: 'SKILL.md',
    }).catch((error: unknown) => error)
    expect(isSkillConflict(failure)).toBe(false)
  })

  it('saveSkillText saves cleanly and reports the new revision', async () => {
    reply = () => ok({ revision: 4 })
    const result = await saveSkillText(
      { scope: ESkillScope.Personal, skill: 'tdd', path: 'SKILL.md', baseRevision: 3 },
      'fresh text',
    )
    expect(result).toEqual({ outcome: 'saved', revision: 4 })
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      baseRevision: 3,
      content: toBase64Utf8('fresh text'),
    })
  })

  it('saveSkillText answers conflict with the fresh server content on a stale write', async () => {
    let puts = 0
    reply = () => {
      puts += 1
      if (puts === 1) return conflict()
      return ok({
        path: 'SKILL.md',
        revision: 3,
        contentHash: 'h',
        sizeBytes: 50,
        isText: true,
        updatedAt: '2026-11-03T00:00:00Z',
        content: toBase64Utf8('server version'),
      })
    }
    const result = await saveSkillText(
      { scope: ESkillScope.Personal, skill: 'tdd', path: 'SKILL.md', baseRevision: 1 },
      'my version',
    )
    expect(result).toEqual({ outcome: 'conflict', theirs: 'server version', revision: 3 })
    expect(calls[1]?.url).toContain('/v1/trpc/skills.get')
  })

  it('saveSkillText rethrows non-conflict failures', async () => {
    reply = () =>
      Response.json(
        {
          error: {
            message: 'boom',
            code: -32603,
            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'skills.put' },
          },
        },
        { status: 500 },
      )
    const failure = await saveSkillText(
      { scope: ESkillScope.Personal, skill: 'tdd', path: 'SKILL.md', baseRevision: 1 },
      'my version',
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
  })

  it('removes a file with its base revision and removes whole skills', async () => {
    reply = () => ok({ removed: true })
    await removeSkillFile({
      scope: ESkillScope.Personal,
      skill: 'tdd',
      path: 'a.md',
      baseRevision: 2,
    })
    expect(calls[0]?.url).toContain('/v1/trpc/skills.remove')
    reply = () => ok({ removed: 3 })
    expect(await removeSkill({ scope: ESkillScope.Personal, skill: 'tdd' })).toBe(3)
    expect(calls[1]?.url).toContain('/v1/trpc/skills.removeSkill')
  })
})
