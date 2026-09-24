import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { createComment, getIssue, markDuplicate, setState, type LinearFetch } from './linear-client'

const LINEAR_URL = 'https://api.linear.app/graphql'

type Call = {
  url: string
  method: string
  authorization: string | undefined
  body: { query: string; variables: Record<string, unknown> }
}

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function fakeFetch(handlers: Record<string, (call: Call) => Response>): {
  fetchFn: LinearFetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
      body: JSON.parse(String(init?.body)) as Call['body'],
    }
    calls.push(call)
    const route = Object.entries(handlers).find(([needle]) => call.body.query.includes(needle))
    if (route === undefined) return jsonResponse(500, { message: 'no handler for this query' })
    return route[1](call)
  }) as LinearFetch
  return { fetchFn, calls }
}

const ISSUE_PAYLOAD = {
  issue: {
    id: 'issue-uuid-1',
    identifier: 'ENG-341',
    title: 'Intake never fires',
    description: 'webhook events are unsubscribed',
    url: 'https://linear.app/compai/issue/ENG-341/intake-never-fires',
    state: { name: 'In Progress', type: 'started' },
    comments: {
      nodes: [
        {
          body: 'looking at this',
          createdAt: '2026-09-24T10:00:00.000Z',
          user: { displayName: 'Dennis' },
        },
        { body: 'automated note', createdAt: '2026-09-24T11:00:00.000Z', user: null },
      ],
    },
  },
}

const STATES_PAYLOAD = {
  issue: {
    team: {
      states: {
        nodes: [
          { id: 'state-backlog', name: 'Backlog', type: 'backlog' },
          { id: 'state-progress', name: 'In Progress', type: 'started' },
          { id: 'state-done', name: 'Done', type: 'completed' },
        ],
      },
    },
  },
}

describe('linear client', () => {
  describe('getIssue', () => {
    it('posts the issue query with the bearer token and maps the issue', async () => {
      const { fetchFn, calls } = fakeFetch({
        'issue(id: $id)': () => jsonResponse(200, { data: ISSUE_PAYLOAD }),
      })

      const issue = await getIssue({ token: 'lin_oauth_token', issueId: 'ENG-341', fetchFn })

      expect(issue).toEqual({
        id: 'issue-uuid-1',
        identifier: 'ENG-341',
        title: 'Intake never fires',
        description: 'webhook events are unsubscribed',
        stateName: 'In Progress',
        stateType: 'started',
        url: 'https://linear.app/compai/issue/ENG-341/intake-never-fires',
        comments: [
          { author: 'Dennis', body: 'looking at this', createdAt: '2026-09-24T10:00:00.000Z' },
          { author: null, body: 'automated note', createdAt: '2026-09-24T11:00:00.000Z' },
        ],
      })
      expect(calls).toHaveLength(1)
      const [call] = calls as [Call]
      expect(call.url).toBe(LINEAR_URL)
      expect(call.method).toBe('POST')
      expect(call.authorization).toBe('Bearer lin_oauth_token')
      expect(call.body.query).toContain('comments(first: 50)')
      expect(call.body.variables).toEqual({ id: 'ENG-341' })
    })

    it('rejects with BadRequestException when the issue does not exist', async () => {
      const { fetchFn } = fakeFetch({
        'issue(id: $id)': () => jsonResponse(200, { data: { issue: null } }),
      })

      await expect(
        getIssue({ token: 'tok', issueId: 'ENG-999', fetchFn }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('createComment', () => {
    it('posts commentCreate with the issue id and body and returns the comment url', async () => {
      const { fetchFn, calls } = fakeFetch({
        commentCreate: () =>
          jsonResponse(200, {
            data: {
              commentCreate: {
                comment: { url: 'https://linear.app/compai/issue/ENG-341#comment-abc' },
              },
            },
          }),
      })

      const posted = await createComment({
        token: 'lin_oauth_token',
        issueId: 'issue-uuid-1',
        body: 'triage: duplicate of ENG-100',
        fetchFn,
      })

      expect(posted.url).toBe('https://linear.app/compai/issue/ENG-341#comment-abc')
      const [call] = calls as [Call]
      expect(call.authorization).toBe('Bearer lin_oauth_token')
      expect(call.body.query).toContain('commentCreate(input: { issueId: $issueId, body: $body })')
      expect(call.body.variables).toEqual({
        issueId: 'issue-uuid-1',
        body: 'triage: duplicate of ENG-100',
      })
    })
  })

  describe('setState', () => {
    it('matches the state name case-insensitively and updates by state id', async () => {
      const { fetchFn, calls } = fakeFetch({
        'team { states': () => jsonResponse(200, { data: STATES_PAYLOAD }),
        issueUpdate: () =>
          jsonResponse(200, { data: { issueUpdate: { issue: { state: { name: 'Done' } } } } }),
      })

      const updated = await setState({
        token: 'lin_oauth_token',
        issueId: 'ENG-341',
        stateName: 'done',
        fetchFn,
      })

      expect(updated).toEqual({ stateName: 'Done' })
      expect(calls).toHaveLength(2)
      const [lookup, update] = calls as [Call, Call]
      expect(lookup.body.variables).toEqual({ id: 'ENG-341' })
      expect(update.body.query).toContain('issueUpdate(id: $id, input: { stateId: $stateId })')
      expect(update.body.variables).toEqual({ id: 'ENG-341', stateId: 'state-done' })
    })

    it('rejects an unknown state name listing the valid names', async () => {
      const { fetchFn, calls } = fakeFetch({
        'team { states': () => jsonResponse(200, { data: STATES_PAYLOAD }),
      })

      await expect(
        setState({ token: 'tok', issueId: 'ENG-341', stateName: 'Shipped', fetchFn }),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        setState({ token: 'tok', issueId: 'ENG-341', stateName: 'Shipped', fetchFn }),
      ).rejects.toThrow('valid states: Backlog, In Progress, Done')
      expect(calls.every((call) => !call.body.query.includes('issueUpdate'))).toBe(true)
    })
  })

  describe('markDuplicate', () => {
    it('creates a duplicate issue relation and returns the issue url', async () => {
      const { fetchFn, calls } = fakeFetch({
        issueRelationCreate: () =>
          jsonResponse(200, {
            data: {
              issueRelationCreate: {
                issueRelation: {
                  issue: { url: 'https://linear.app/compai/issue/ENG-341/intake-never-fires' },
                },
              },
            },
          }),
      })

      const marked = await markDuplicate({
        token: 'lin_oauth_token',
        issueId: 'issue-uuid-1',
        duplicateOfId: 'issue-uuid-100',
        fetchFn,
      })

      expect(marked.url).toBe('https://linear.app/compai/issue/ENG-341/intake-never-fires')
      const [call] = calls as [Call]
      expect(call.authorization).toBe('Bearer lin_oauth_token')
      expect(call.body.query).toContain('type: duplicate')
      expect(call.body.variables).toEqual({
        issueId: 'issue-uuid-1',
        duplicateOfId: 'issue-uuid-100',
      })
    })
  })

  describe('failures', () => {
    it('treats a 200 carrying an errors array as a failure with the first message', async () => {
      const { fetchFn } = fakeFetch({
        'issue(id: $id)': () =>
          jsonResponse(200, { errors: [{ message: 'Argument Validation Error' }] }),
      })

      await expect(
        getIssue({ token: 'tok', issueId: 'ENG-341', fetchFn }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      await expect(getIssue({ token: 'tok', issueId: 'ENG-341', fetchFn })).rejects.toThrow(
        'Argument Validation Error',
      )
    })

    it('a non-200 carries the status and capped detail', async () => {
      const { fetchFn } = fakeFetch({
        'issue(id: $id)': () => jsonResponse(401, { message: 'authentication required' }),
      })

      await expect(
        getIssue({ token: 'expired', issueId: 'ENG-341', fetchFn }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      await expect(getIssue({ token: 'expired', issueId: 'ENG-341', fetchFn })).rejects.toThrow(
        'linear answered 401',
      )
    })
  })
})
