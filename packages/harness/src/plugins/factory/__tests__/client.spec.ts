import { describe, expect, it } from 'bun:test'

import { CloudError } from '../../../cloud/cloud-transport'
import { EStationKind, FactoryClient } from '../client'

type SeenCall = {
  url: string
  method: string
  authorization: string | null
  body: unknown
}

const clientWith = (args?: {
  responder?: (url: string) => { status: number; payload: unknown }
}): { client: FactoryClient; calls: SeenCall[] } => {
  const calls: SeenCall[] = []
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })
    const answer =
      args?.responder?.(url) ??
      (url.endsWith('/diff')
        ? { status: 200, payload: { diff: 'diff --git a/x b/x' } }
        : { status: 200, payload: { ok: true } })
    return new Response(JSON.stringify(answer.payload), { status: answer.status })
  }
  return {
    client: new FactoryClient({
      url: 'https://api.byatlas.io/',
      token: 'atlas_serve_token',
      fetchFn: fetchFn as typeof fetch,
    }),
    calls,
  }
}

type Case = {
  name: string
  invoke: (client: FactoryClient) => Promise<unknown>
  method: string
  path: string
  body?: unknown
}

const REF = { owner: 'dennisofficial', repo: 'atlas', number: 672 }

const CASES: readonly Case[] = [
  {
    name: 'reply',
    invoke: (client) => client.reply({ surface: 'github', externalId: '12', body: 'on it' }),
    method: 'POST',
    path: '/v1/factory/replies',
    body: { surface: 'github', externalId: '12', body: 'on it' },
  },
  {
    name: 'spawnStation',
    invoke: (client) => client.spawnStation({ kind: EStationKind.Implementer, message: 'build it' }),
    method: 'POST',
    path: '/v1/factory/stations',
    body: { kind: 'implementer', message: 'build it' },
  },
  {
    name: 'steerStation',
    invoke: (client) => client.steerStation({ runId: 'run-1', message: 'focus on tests' }),
    method: 'POST',
    path: '/v1/factory/stations/run-1/steer',
    body: { message: 'focus on tests' },
  },
  {
    name: 'stopStation',
    invoke: (client) => client.stopStation({ runId: 'run-1' }),
    method: 'POST',
    path: '/v1/factory/stations/run-1/stop',
  },
  {
    name: 'deliver',
    invoke: (client) => client.deliver({ title: 'Add the thing', body: 'This adds the thing.' }),
    method: 'POST',
    path: '/v1/factory/deliveries',
    body: { title: 'Add the thing', body: 'This adds the thing.' },
  },
  {
    name: 'submitResult',
    invoke: (client) => client.submitResult({ runId: 'run-1', result: { summary: 'done', prs: 2 } }),
    method: 'POST',
    path: '/v1/factory/stations/run-1/result',
    body: { result: { summary: 'done', prs: 2 } },
  },
  {
    name: 'gitToken',
    invoke: (client) => client.gitToken({ branch: 'atlas-factory/eng-1' }),
    method: 'POST',
    path: '/v1/factory/git-token',
    body: { branch: 'atlas-factory/eng-1' },
  },
  {
    name: 'githubIssue',
    invoke: (client) => client.githubIssue(REF),
    method: 'GET',
    path: '/v1/factory/tools/github/issues/dennisofficial/atlas/672',
  },
  {
    name: 'githubComments',
    invoke: (client) => client.githubComments(REF),
    method: 'GET',
    path: '/v1/factory/tools/github/issues/dennisofficial/atlas/672/comments',
  },
  {
    name: 'githubPullRequest',
    invoke: (client) => client.githubPullRequest(REF),
    method: 'GET',
    path: '/v1/factory/tools/github/pulls/dennisofficial/atlas/672',
  },
  {
    name: 'githubDiff',
    invoke: (client) => client.githubDiff(REF),
    method: 'GET',
    path: '/v1/factory/tools/github/pulls/dennisofficial/atlas/672/diff',
  },
  {
    name: 'githubCloseIssue',
    invoke: (client) => client.githubCloseIssue({ ...REF, body: 'fixed in #672' }),
    method: 'POST',
    path: '/v1/factory/tools/github/issues/dennisofficial/atlas/672/close',
    body: { body: 'fixed in #672' },
  },
  {
    name: 'githubAddLabel',
    invoke: (client) => client.githubAddLabel({ ...REF, label: 'ready-for-agent' }),
    method: 'POST',
    path: '/v1/factory/tools/github/issues/dennisofficial/atlas/672/labels',
    body: { label: 'ready-for-agent' },
  },
  {
    name: 'githubRemoveLabel',
    invoke: (client) => client.githubRemoveLabel({ ...REF, label: 'needs-triage' }),
    method: 'DELETE',
    path: '/v1/factory/tools/github/issues/dennisofficial/atlas/672/labels/needs-triage',
  },
  {
    name: 'linearIssue',
    invoke: (client) => client.linearIssue({ issueId: 'ENG-1' }),
    method: 'GET',
    path: '/v1/factory/tools/linear/issues/ENG-1',
  },
  {
    name: 'linearComment',
    invoke: (client) => client.linearComment({ issueId: 'ENG-1', body: 'looking' }),
    method: 'POST',
    path: '/v1/factory/tools/linear/issues/ENG-1/comments',
    body: { body: 'looking' },
  },
  {
    name: 'linearSetState',
    invoke: (client) => client.linearSetState({ issueId: 'ENG-1', stateName: 'In Progress' }),
    method: 'POST',
    path: '/v1/factory/tools/linear/issues/ENG-1/state',
    body: { stateName: 'In Progress' },
  },
  {
    name: 'linearMarkDuplicate',
    invoke: (client) => client.linearMarkDuplicate({ issueId: 'ENG-1', duplicateOfId: 'ENG-2' }),
    method: 'POST',
    path: '/v1/factory/tools/linear/issues/ENG-1/duplicate',
    body: { duplicateOfId: 'ENG-2' },
  },
]

describe('FactoryClient', () => {
  for (const entry of CASES) {
    it(`${entry.name} calls ${entry.method} ${entry.path} with the bearer token`, async () => {
      const { client, calls } = clientWith()

      await entry.invoke(client)

      expect(calls).toEqual([
        {
          url: `https://api.byatlas.io${entry.path}`,
          method: entry.method,
          authorization: 'Bearer atlas_serve_token',
          body: entry.body,
        },
      ])
    })
  }

  it('githubDiff unwraps the diff string out of the response', async () => {
    const { client } = clientWith({
      responder: () => ({ status: 200, payload: { diff: 'diff --git a/x b/x' } }),
    })

    expect(await client.githubDiff(REF)).toBe('diff --git a/x b/x')
  })

  it('encodes path segments that carry reserved characters', async () => {
    const { client, calls } = clientWith()

    await client.githubRemoveLabel({ ...REF, label: 'needs/triage now' })

    expect(calls[0]?.url).toBe(
      'https://api.byatlas.io/v1/factory/tools/github/issues/dennisofficial/atlas/672/labels/needs%2Ftriage%20now',
    )
  })

  it('raises a CloudError carrying the API detail on a refusal', async () => {
    const { client } = clientWith({
      responder: () => ({ status: 403, payload: { message: 'surface not aliased' } }),
    })

    const failure = await client
      .reply({ surface: 'github', externalId: '12', body: 'hi' })
      .catch((thrown: unknown) => thrown)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(403)
    expect((failure as CloudError).message).toContain('surface not aliased')
  })
})
