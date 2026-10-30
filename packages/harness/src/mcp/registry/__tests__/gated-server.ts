export type GatedMcpServer = {
  url: string
  release: () => void
  stop: () => void
}

export const startGatedMcpServer = (args: { status: number }): GatedMcpServer => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = (await request.json()) as { id: string; method: string }
      await gate
      if (args.status !== 200) return new Response('boom', { status: args.status })
      const result = body.method === 'initialize' ? { capabilities: { tools: {} } } : { tools: [] }
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    },
  })
  return { url: `http://localhost:${server.port}/mcp`, release, stop: () => void server.stop(true) }
}
