import { createApiClient } from '@dltech/atlas-api-router'
import { groupSkillTarget, toBase64Utf8 } from '@dltech/atlas-client/settings'
import { describe, expect, it } from 'bun:test'
import { skillFilesApi } from '../skill-files-api'

const setup = () => {
  const requests: { route: string; input: unknown }[] = []
  let conflict = false
  const files = [
    {
      path: 'refs/a.md',
      revision: 2,
      contentHash: 'hash-a',
      sizeBytes: 1,
      isText: true,
      updatedAt: '',
    },
    {
      path: 'refs/b.md',
      revision: 3,
      contentHash: 'hash-b',
      sizeBytes: 1,
      isText: true,
      updatedAt: '',
    },
    {
      path: 'refs-other.md',
      revision: 4,
      contentHash: 'hash-c',
      sizeBytes: 1,
      isText: true,
      updatedAt: '',
    },
  ]
  const fetchFn: typeof fetch = Object.assign(
    async (target: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(target))
      const route = url.pathname.split('/').at(-1) ?? ''
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const input = url.searchParams.has('input')
        ? JSON.parse(url.searchParams.get('input') ?? '{}')
        : body?.atlasB64
          ? JSON.parse(atob(body.atlasB64))
          : body
      requests.push({ route, input })
      if (conflict && route === 'skills.put')
        return Response.json(
          { error: { message: 'conflict', code: -32603, data: { httpStatus: 409 } } },
          { status: 409 },
        )
      const data =
        route === 'skills.listFiles'
          ? { files }
          : route === 'skills.get'
            ? { ...files.find((file) => file.path === input.path), content: toBase64Utf8('server') }
            : { revision: 5, removed: true }
      return Response.json({ result: { data } })
    },
    { preconnect: () => undefined },
  )
  return {
    requests,
    setConflict: () => {
      conflict = true
    },
    files: skillFilesApi({
      api: createApiClient({ baseUrl: 'https://test.example', fetchFn }),
      target: { ...groupSkillTarget({ groupId: 'g' }), skill: 'test' },
      hashOf: async () => 'hash',
    }),
  }
}

describe('mobile skill files API', () => {
  it('loads and saves text with the scope and base revision', async () => {
    const { files, requests } = setup()
    expect(await files.readText({ path: 'refs/a.md' })).toEqual({ text: 'server', revision: 2 })
    expect(await files.save({ path: 'refs/a.md', text: 'mine', baseRevision: 2 })).toEqual({
      outcome: 'saved',
      revision: 5,
    })
    expect(requests.at(-1)).toEqual({
      route: 'skills.put',
      input: {
        scope: 'group',
        groupId: 'g',
        skill: 'test',
        path: 'refs/a.md',
        baseRevision: 2,
        content: toBase64Utf8('mine'),
        contentHash: 'hash',
      },
    })
  })
  it('keeps a conflict response distinct from a successful save', async () => {
    const { files, setConflict } = setup()
    setConflict()
    expect(await files.save({ path: 'refs/a.md', text: 'mine', baseRevision: 1 })).toEqual({
      outcome: 'conflict',
      theirs: 'server',
      revision: 2,
    })
  })
  it('deletes a folder with each file revision, not prefix siblings', async () => {
    const { files, requests } = setup()
    await files.remove({ path: 'refs' })
    expect(
      requests
        .filter((request) => request.route === 'skills.remove')
        .map((request) => request.input),
    ).toEqual([
      { scope: 'group', groupId: 'g', skill: 'test', path: 'refs/a.md', baseRevision: 2 },
      { scope: 'group', groupId: 'g', skill: 'test', path: 'refs/b.md', baseRevision: 3 },
    ])
  })
  it('copies before deleting on rename and rejects destination collisions', async () => {
    const { files, requests } = setup()
    await files.rename({ from: 'refs', to: 'guides' })
    expect(requests.map((request) => request.route)).toEqual([
      'skills.listFiles',
      'skills.get',
      'skills.put',
      'skills.remove',
      'skills.get',
      'skills.put',
      'skills.remove',
    ])
    expect(requests[2]?.input).toMatchObject({
      path: 'guides/a.md',
      content: toBase64Utf8('server'),
      contentHash: 'hash-a',
      baseRevision: 0,
    })
    await expect(files.rename({ from: 'refs', to: 'refs-other.md' })).rejects.toThrow()
  })
  it('creates empty text and replaces binary content at the loaded revision', async () => {
    const { files, requests } = setup()
    await files.addText({ path: 'notes.md' })
    expect(requests.at(-1)?.input).toMatchObject({
      path: 'notes.md',
      content: '',
      contentHash: 'hash',
    })
    await files.write({ path: 'logo.png', content: 'AQID', baseRevision: 7 })
    expect(requests.at(-1)?.input).toMatchObject({
      path: 'logo.png',
      content: 'AQID',
      baseRevision: 7,
    })
    await files.removeSkill()
    expect(requests.at(-1)).toEqual({
      route: 'skills.removeSkill',
      input: { scope: 'group', groupId: 'g', skill: 'test' },
    })
  })
})
