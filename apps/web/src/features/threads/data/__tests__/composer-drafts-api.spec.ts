import { describe, expect, it } from 'bun:test'

import { fakeFetch, mutationUrl, queryUrl, trpcOk } from './trpc-fake'

import { clearDraft, fetchDraft, putDraft } from '../composer-drafts-api'

const upload = {
  uploadId: '11111111-1111-4111-8111-111111111111',
  pathname: 'u/a.txt',
  name: 'a.txt',
  size: 3,
  mediaType: 'text/plain',
}

describe('composer drafts api', () => {
  it('fetches a stored draft by scope', async () => {
    const calls = fakeFetch(() =>
      trpcOk({
        draft: {
          scope: 't1',
          text: 'hi',
          uploads: [upload],
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
      }),
    )
    expect(await fetchDraft('t1')).toEqual({ text: 'hi', uploads: [upload] })
    expect(calls[0]?.url).toContain(
      queryUrl({ procedure: 'composerDrafts.get', input: { scope: 't1' } }),
    )
  })

  it('answers null when no draft is stored', async () => {
    fakeFetch(() => trpcOk({ draft: null }))
    expect(await fetchDraft('new')).toBeNull()
  })

  it('puts text and uploads under the scope', async () => {
    const calls = fakeFetch(() =>
      trpcOk({ scope: 't1', text: 'hi', uploads: [upload], updatedAt: '2026-11-01T00:00:00.000Z' }),
    )
    await putDraft({ scope: 't1', text: 'hi', uploads: [upload] })
    expect(calls[0]?.url).toContain(mutationUrl('composerDrafts.put'))
    expect(calls[0]?.body).toEqual({ scope: 't1', text: 'hi', uploads: [upload] })
  })

  it('clears by scope', async () => {
    const calls = fakeFetch(() => trpcOk({ ok: true }))
    await clearDraft('t1')
    expect(calls[0]?.url).toContain(mutationUrl('composerDrafts.clear'))
    expect(calls[0]?.body).toEqual({ scope: 't1' })
  })
})
