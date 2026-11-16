import type { ArtifactSummary, ArtifactUpload } from '@dltech/atlas-wire'

import { trpcCallOf, trpcFailure } from '../../cloud/__tests__/trpc-wire'
import type { CloudSession } from '../../cloud/cloud-session'
import { CloudArtifactPort } from '../cloud-artifact-port'

export const SESSION: CloudSession = { url: 'https://cloud.test', token: 'tok-1', email: null }

export type Call = {
  url: string
  method: string
  procedure: string
  authorization: string | null
  input: unknown
  signalled: boolean
}

export const BEGINNED = {
  artifactId: 'art_1',
  token: 'artifact-token',
  subdomain: 'demo',
  version: 3,
  uploads: [
    {
      path: 'index.html',
      tree: 'src',
      sha256: 'a'.repeat(64),
      url: 'https://upload.test/index.html',
    },
  ] satisfies ArtifactUpload[],
}

export const SUMMARY: ArtifactSummary = {
  subdomain: 'demo',
  name: 'Demo',
  url: 'https://demo.artifacts.test',
  status: 'ready',
  updatedAt: '2026-11-01T00:00:00.000Z',
}

export const portWith = (args: {
  respond: (call: Call) => Response
  session?: CloudSession | null
}) => {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const traced = trpcCallOf({ input, init })
    const call: Call = {
      url: String(input),
      method: traced.method,
      procedure: traced.procedure,
      authorization: headers.get('authorization'),
      input: traced.input,
      signalled: init?.signal !== null && init?.signal !== undefined,
    }
    calls.push(call)
    return args.respond(call)
  }) as typeof fetch
  const port = new CloudArtifactPort({
    session: () => (args.session === undefined ? SESSION : args.session),
    clientVersion: '1.0.0',
    fetchFn,
  })
  return { port, calls }
}

export const failure = (args: { status: number; trpcCode: string; message?: string }): Response =>
  trpcFailure({
    status: args.status,
    message: args.message ?? 'refused',
    trpcCode: args.trpcCode,
  })

export const entry = {
  path: 'index.html',
  tree: 'src' as const,
  sha256: 'a'.repeat(64),
  size: 12,
  type: 'text/html',
}

export const failureOf = async (run: Promise<unknown>): Promise<unknown> =>
  run.then(
    () => null,
    (error: unknown) => error,
  )
