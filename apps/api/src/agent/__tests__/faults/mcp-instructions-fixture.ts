import { createInterface } from 'node:readline'

export const FIXTURE_INSTRUCTIONS = 'the fixture server gives these instructions on every connect'

const PROTOCOL_VERSION = '2025-06-18'

const TOOLS = [
  { name: 'echo', description: 'echo the input back', inputSchema: { type: 'object' } },
]

type Request = { id?: unknown; method?: unknown }

const resultOf = (request: Request): unknown => {
  if (request.method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '1' },
      instructions: FIXTURE_INSTRUCTIONS,
    }
  }
  if (request.method === 'tools/list') return { tools: TOOLS }
  return {}
}

const serve = (): void => {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    const request = JSON.parse(line) as Request
    if (request.id === undefined || request.id === null) return
    const message = { jsonrpc: '2.0', id: request.id, result: resultOf(request) }
    process.stdout.write(`${JSON.stringify(message)}\n`)
  })
}

if (import.meta.main) serve()
