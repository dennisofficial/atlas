import { describe, expect, it } from 'bun:test'

import { EPullRequestRoute, PullRequestsClient } from '../../../cloud/pull-requests-client'

import { ApiPullRequestPort } from '../api-pull-requests'
import {
  EChecksState,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  type PullRequestReading,
} from '../pure'
import { aCheckout } from '../testing'

const DTO = {
  repoFullName: 'dennisofficial/atlas',
  number: 42,
  title: 'a change',
  url: 'https://github.com/dennisofficial/atlas/pull/42',
  state: 'open',
  headBranch: 'main',
  headSha: 'abc123',
  checks: { running: 1, passed: 2, failed: 0 },
  mergeable: true,
  mergeableState: 'clean',
  updatedAt: '2026-09-22T10:00:00.000Z',
}

const clientWith = (args: {
  answer: (url: string) => Response
  route?: EPullRequestRoute
}): { client: PullRequestsClient; calls: string[] } => {
  const calls: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    return args.answer(url)
  }) as typeof fetch

  return {
    client: new PullRequestsClient({
      url: 'https://api.test',
      token: 'tok',
      route: args.route ?? EPullRequestRoute.User,
      fetchFn,
    }),
    calls,
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

const found = (reading: PullRequestReading): number => {
  if (reading.lookup !== EPullRequestLookup.Found) throw new Error('expected a found reading')
  return reading.pullRequest.number
}

describe('ApiPullRequestPort', () => {
  it('maps a found dto onto a pull request reading', async () => {
    const { client, calls } = clientWith({ answer: () => json(DTO) })
    const port = new ApiPullRequestPort({ client })

    const reading = await port.read({ checkout: aCheckout({ branch: 'dennis/thing' }) })

    expect(found(reading)).toBe(42)
    if (reading.lookup !== EPullRequestLookup.Found) return
    expect(reading.pullRequest.state).toBe(EPullRequestState.Open)
    expect(reading.pullRequest.checks).toBe(EChecksState.Running)
    expect(reading.pullRequest.tally).toEqual({ running: 1, passed: 2, failed: 0 })
    expect(calls[0]).toBe(
      'https://api.test/v1/github/prs?repo=dennisofficial%2Fatlas&branch=dennis%2Fthing',
    )
  })

  it('rolls a failing tally up as failing even while others run', async () => {
    const { client } = clientWith({
      answer: () => json({ ...DTO, state: 'draft', checks: { running: 2, passed: 1, failed: 1 } }),
    })
    const port = new ApiPullRequestPort({ client })

    const reading = await port.read({ checkout: aCheckout() })

    if (reading.lookup !== EPullRequestLookup.Found) throw new Error('expected a found reading')
    expect(reading.pullRequest.state).toBe(EPullRequestState.Draft)
    expect(reading.pullRequest.checks).toBe(EChecksState.Failing)
  })

  it('reads an empty answer as definitively absent', async () => {
    const { client } = clientWith({ answer: () => new Response('', { status: 200 }) })
    const port = new ApiPullRequestPort({ client })

    expect(await port.read({ checkout: aCheckout() })).toEqual({ lookup: EPullRequestLookup.Absent })
  })

  it('refuses a forge the API cannot answer for, without retrying', async () => {
    const { client, calls } = clientWith({ answer: () => json(DTO) })
    const port = new ApiPullRequestPort({ client })

    const reading = await port.read({ checkout: aCheckout({ forge: EForge.Other }) })

    expect(reading).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: false })
    expect(calls).toEqual([])
  })

  it('reads a 403 as settled and a 404 as worth asking again', async () => {
    const denied = new ApiPullRequestPort({
      client: clientWith({ answer: () => json({ message: 'connect github' }, 403) }).client,
    })
    const missing = new ApiPullRequestPort({
      client: clientWith({ answer: () => json({ message: 'not found' }, 404) }).client,
    })

    expect(await denied.read({ checkout: aCheckout() })).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: false,
    })
    expect(await missing.read({ checkout: aCheckout() })).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: true,
    })
  })

  it('reads a linked pull request by number through the same route', async () => {
    const { client, calls } = clientWith({ answer: () => json({ ...DTO, state: 'merged' }) })
    const port = new ApiPullRequestPort({ client })

    const reading = await port.readLinked({ repo: 'github.com/dennisofficial/atlas', number: 42 })

    expect(found(reading)).toBe(42)
    if (reading.lookup !== EPullRequestLookup.Found) return
    expect(reading.pullRequest.state).toBe(EPullRequestState.Merged)
    expect(calls[0]).toBe('https://api.test/v1/github/prs?repo=dennisofficial%2Fatlas&number=42')
  })

  it('refuses a linked repo off github.com without asking', async () => {
    const { client, calls } = clientWith({ answer: () => json(DTO) })
    const port = new ApiPullRequestPort({ client })

    const reading = await port.readLinked({ repo: 'gitlab.com/dennisofficial/atlas', number: 42 })

    expect(reading).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: false })
    expect(calls).toEqual([])
  })

  it('asks the sandbox route when the client was built for a sandbox', async () => {
    const { client, calls } = clientWith({
      answer: () => json(DTO),
      route: EPullRequestRoute.Sandbox,
    })
    const port = new ApiPullRequestPort({ client })

    await port.read({ checkout: aCheckout() })

    expect(calls[0]).toBe(
      'https://api.test/v1/sandboxes/github/prs?repo=dennisofficial%2Fatlas&branch=main',
    )
  })
})
