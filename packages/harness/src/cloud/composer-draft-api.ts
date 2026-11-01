import type { ApiClient } from '@dltech/atlas-api-router'

import { createHarnessApiClient } from './api-trpc-client'
import type { CloudSession } from './cloud-session'

export type ComposerDraftApi = {
  load: (args: { scope: string }) => Promise<string | null>
  save: (args: { scope: string; text: string }) => Promise<void>
  discard: (args: { scope: string }) => Promise<void>
}

export const composerDraftApiFor = (args: {
  session: () => CloudSession | null
  clientVersion: string
  fetchFn: typeof fetch
}): ComposerDraftApi => {
  let held: { url: string; token: string; api: ApiClient } | undefined

  const clientOf = (): ApiClient => {
    const session = args.session()
    if (session === null) throw new Error('There is no Atlas Cloud sign-in.')
    if (held?.url === session.url && held.token === session.token) return held.api
    const api = createHarnessApiClient({
      url: session.url,
      token: session.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
    })
    held = { url: session.url, token: session.token, api }
    return api
  }

  return {
    load: async ({ scope }) => {
      const reply = await clientOf().composerDrafts.get.query({ scope })
      return reply.draft?.text ?? null
    },
    save: async ({ scope, text }) => {
      await clientOf().composerDrafts.put.mutate({ scope, text, uploads: [] })
    },
    discard: async ({ scope }) => {
      await clientOf().composerDrafts.clear.mutate({ scope })
    },
  }
}
