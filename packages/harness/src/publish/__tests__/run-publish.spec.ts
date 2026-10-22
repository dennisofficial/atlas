import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'bun:test'

import { PublishedBundleClient } from '../../cloud/published-bundle-client'
import { publishBundle, EPublishStage } from '../run-publish'
import { scanPublishables } from '../publishables'
import { makeFixture, type PublishFixture } from './fixture'

let fixture: PublishFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

type Call = {
  method: string
  url: string
  authorization: string | null
  contentType: string | null
  body: unknown
}

const LAYOUT = {
  'home/.agents/skills/alpha/SKILL.md': 'alpha',
  'atlas-home/ATLAS.md': 'be nice',
  'atlas-home/mcp.json': '{}',
}

const summary = {
  version: 3,
  sha256: 'a'.repeat(64),
  sizeBytes: 10,
  manifest: { skills: [], instructions: [], mcp: false },
  createdAt: 'now',
}

function fakeCloud(args: { putStatus: number }) {
  const calls: Call[] = []
  let putBody: Uint8Array | undefined
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const isPut = init?.method === 'PUT'
    if (isPut) putBody = new Uint8Array(init?.body as ArrayBuffer)
    calls.push({
      method: init?.method ?? 'GET',
      url,
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    if (isPut)
      return new Response(args.putStatus === 200 ? '' : 'denied', { status: args.putStatus })
    if (url.endsWith('/uploads')) {
      return Response.json({
        pathname: 'bundles/u/1.tar.gz',
        uploadUrl: 'https://blob.test/put?sig=1',
        contentType: 'application/gzip',
        maximumSizeInBytes: 1_000_000,
        validUntil: 1,
      })
    }
    return Response.json(summary)
  }) as typeof fetch
  const client = new PublishedBundleClient({
    url: 'https://cloud.test',
    token: 'sess',
    clientVersion: '1',
    fetchFn,
  })
  return { client, fetchFn, calls, putBody: () => putBody }
}

describe('publishBundle', () => {
  it('uploads without a bearer and commits the sha of the uploaded bytes', async () => {
    fixture = await makeFixture(LAYOUT)
    const items = await scanPublishables(fixture)
    const cloud = fakeCloud({ putStatus: 200 })
    const stages: EPublishStage[] = []

    const result = await publishBundle({
      items,
      client: cloud.client,
      fetchFn: cloud.fetchFn,
      onStage: ({ stage }) => stages.push(stage),
    })

    expect(result.version).toBe(3)
    expect(stages).toEqual([
      EPublishStage.Packing,
      EPublishStage.Uploading,
      EPublishStage.Committing,
    ])
    const put = cloud.calls.find((call) => call.method === 'PUT')
    expect(put?.url).toBe('https://blob.test/put?sig=1')
    expect(put?.authorization).toBeNull()
    expect(put?.contentType).toBe('application/gzip')

    const commit = cloud.calls.find(
      (call) => call.method === 'POST' && !call.url.endsWith('/uploads'),
    )
    const bytes = cloud.putBody()
    expect(bytes).toBeDefined()
    expect(commit?.body).toEqual({
      pathname: 'bundles/u/1.tar.gz',
      sha256: createHash('sha256')
        .update(bytes ?? new Uint8Array())
        .digest('hex'),
      manifest: { skills: ['.agents/alpha'], instructions: ['ATLAS.md'], mcp: true },
    })
    expect(commit?.authorization).toBe('Bearer sess')
  })

  it('does not commit when the upload fails', async () => {
    fixture = await makeFixture(LAYOUT)
    const items = await scanPublishables(fixture)
    const cloud = fakeCloud({ putStatus: 403 })

    await expect(
      publishBundle({ items, client: cloud.client, fetchFn: cloud.fetchFn }),
    ).rejects.toThrow(/403: denied/)
    expect(cloud.calls.filter((call) => call.url.endsWith('/published-bundles'))).toEqual([])
  })
})
