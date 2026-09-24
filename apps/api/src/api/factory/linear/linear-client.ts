import { BadGatewayException, BadRequestException } from '@nestjs/common'

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'
const DETAIL_CAP = 300

export type LinearFetch = typeof fetch

interface GraphqlError {
  message: string
}

interface GraphqlResponse<T> {
  data?: T
  errors?: GraphqlError[]
}

interface LinearCommentNode {
  body: string
  createdAt: string
  user: { displayName: string } | null
}

interface LinearIssueNode {
  id: string
  identifier: string
  title: string
  description: string | null
  url: string
  state: { name: string; type: string }
  comments: { nodes: LinearCommentNode[] }
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  stateName: string
  stateType: string
  url: string
  comments: { author: string | null; body: string; createdAt: string }[]
}

const ISSUE_QUERY = `query Issue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    state { name type }
    comments(first: 50) { nodes { body createdAt user { displayName } } }
  }
}`

const COMMENT_CREATE_MUTATION = `mutation CommentCreate($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    comment { url }
  }
}`

const TEAM_STATES_QUERY = `query IssueTeamStates($id: String!) {
  issue(id: $id) {
    team { states { nodes { id name type } } }
  }
}`

const ISSUE_SET_STATE_MUTATION = `mutation IssueSetState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    issue { state { name } }
  }
}`

// Linear has no duplicateOfId on issueUpdate; duplicates are issue relations of type
// `duplicate` — https://linear.app/developers/graphql (schema: IssueRelationCreateInput).
const ISSUE_MARK_DUPLICATE_MUTATION = `mutation IssueMarkDuplicate($issueId: String!, $duplicateOfId: String!) {
  issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $duplicateOfId, type: duplicate }) {
    issueRelation { issue { url } }
  }
}`

async function linearGraphql<T>(args: {
  token: string
  query: string
  variables: Record<string, unknown>
  fetchFn?: LinearFetch | undefined
}): Promise<T> {
  const fetchFn = args.fetchFn ?? fetch
  const response = await fetchFn(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: args.query, variables: args.variables }),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, DETAIL_CAP)
    throw new BadGatewayException(`linear answered ${response.status}: ${detail}`)
  }
  const payload = (await response.json()) as GraphqlResponse<T>
  const firstError = payload.errors?.[0]
  if (firstError !== undefined) {
    throw new BadGatewayException(
      `linear returned an error: ${firstError.message.slice(0, DETAIL_CAP)}`,
    )
  }
  if (payload.data === undefined) {
    throw new BadGatewayException('linear returned no data')
  }
  return payload.data
}

export async function getIssue(args: {
  token: string
  issueId: string
  fetchFn?: LinearFetch | undefined
}): Promise<LinearIssue> {
  const data = await linearGraphql<{ issue: LinearIssueNode | null }>({
    token: args.token,
    fetchFn: args.fetchFn,
    query: ISSUE_QUERY,
    variables: { id: args.issueId },
  })
  if (data.issue === null) {
    throw new BadRequestException(`linear issue ${args.issueId} does not exist`)
  }
  return {
    id: data.issue.id,
    identifier: data.issue.identifier,
    title: data.issue.title,
    description: data.issue.description,
    stateName: data.issue.state.name,
    stateType: data.issue.state.type,
    url: data.issue.url,
    comments: data.issue.comments.nodes.map((node) => ({
      author: node.user?.displayName ?? null,
      body: node.body,
      createdAt: node.createdAt,
    })),
  }
}

export async function createComment(args: {
  token: string
  issueId: string
  body: string
  fetchFn?: LinearFetch | undefined
}): Promise<{ url: string }> {
  const data = await linearGraphql<{ commentCreate: { comment: { url: string } } }>({
    token: args.token,
    fetchFn: args.fetchFn,
    query: COMMENT_CREATE_MUTATION,
    variables: { issueId: args.issueId, body: args.body },
  })
  return { url: data.commentCreate.comment.url }
}

export async function setState(args: {
  token: string
  issueId: string
  stateName: string
  fetchFn?: LinearFetch | undefined
}): Promise<{ stateName: string }> {
  const data = await linearGraphql<{
    issue: { team: { states: { nodes: { id: string; name: string; type: string }[] } } } | null
  }>({
    token: args.token,
    fetchFn: args.fetchFn,
    query: TEAM_STATES_QUERY,
    variables: { id: args.issueId },
  })
  if (data.issue === null) {
    throw new BadRequestException(`linear issue ${args.issueId} does not exist`)
  }
  const states = data.issue.team.states.nodes
  const wanted = args.stateName.toLowerCase()
  const match = states.find((state) => state.name.toLowerCase() === wanted)
  if (match === undefined) {
    const valid = states.map((state) => state.name).join(', ')
    throw new BadRequestException(
      `unknown linear state "${args.stateName}" for the issue's team; valid states: ${valid}`,
    )
  }
  const updated = await linearGraphql<{ issueUpdate: { issue: { state: { name: string } } } }>({
    token: args.token,
    fetchFn: args.fetchFn,
    query: ISSUE_SET_STATE_MUTATION,
    variables: { id: args.issueId, stateId: match.id },
  })
  return { stateName: updated.issueUpdate.issue.state.name }
}

export async function markDuplicate(args: {
  token: string
  issueId: string
  duplicateOfId: string
  fetchFn?: LinearFetch | undefined
}): Promise<{ url: string }> {
  const data = await linearGraphql<{ issueRelationCreate: { issueRelation: { issue: { url: string } } } }>({
    token: args.token,
    fetchFn: args.fetchFn,
    query: ISSUE_MARK_DUPLICATE_MUTATION,
    variables: { issueId: args.issueId, duplicateOfId: args.duplicateOfId },
  })
  return { url: data.issueRelationCreate.issueRelation.issue.url }
}
