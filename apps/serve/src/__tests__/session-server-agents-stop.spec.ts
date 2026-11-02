import { afterEach, describe, expect, it } from 'bun:test'

import { AGENTS_STOP_PATH, startSessionServer } from '../session-server'

const TOKEN = 'serve-token'
const THREAD = 'thread-a'

const servers: { stop: (force: boolean) => unknown }[] = []

afterEach(() => {
  for (const server of servers.splice(0)) void server.stop(true)
})

const serve = (args: {
  control?: { stopChildren: (given: { agentId: string }) => Promise<unknown> } | undefined
}): { port: number } => {
  const { server } = startSessionServer({
    port: 0,
    token: TOKEN,
    threadId: THREAD,
    handlers: () => undefined,
    drain: () => undefined,
    health: () => ({ ok: true }),
    ...(args.control === undefined ? {} : { control: () => args.control }),
  })
  servers.push(server)
  return { port: server.port ?? 0 }
}

const postStop = (args: {
  port: number
  token?: string | undefined
  body?: unknown
}): Promise<Response> =>
  fetch(`http://127.0.0.1:${args.port}${AGENTS_STOP_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.token ?? TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args.body ?? { agentId: 'brn_mate' }),
  })

describe('session server agents stop', () => {
  it('forwards the stop to the control with the named agent', async () => {
    const stops: string[] = []
    const { port } = serve({
      control: {
        stopChildren: async ({ agentId }) => {
          stops.push(agentId)
          return { agentId, stoppedAgents: 2, killedShells: 1 }
        },
      },
    })

    const response = await postStop({ port })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      agentId: 'brn_mate',
      stoppedAgents: 2,
      killedShells: 1,
    })
    expect(stops).toEqual(['brn_mate'])
  })

  it('refuses a wrong token', async () => {
    const { port } = serve({ control: { stopChildren: async () => ({}) } })

    expect((await postStop({ port, token: 'nope' })).status).toBe(401)
  })

  it('refuses a body without an agent id', async () => {
    const { port } = serve({ control: { stopChildren: async () => ({}) } })

    expect((await postStop({ port, body: {} })).status).toBe(400)
  })

  it('answers 503 while no control is installed yet', async () => {
    const { port } = serve({})

    expect((await postStop({ port })).status).toBe(503)
  })

  it('refuses a non-POST method', async () => {
    const { port } = serve({ control: { stopChildren: async () => ({}) } })

    const response = await fetch(`http://127.0.0.1:${port}${AGENTS_STOP_PATH}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(405)
  })
})
