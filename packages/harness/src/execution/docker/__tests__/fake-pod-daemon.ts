import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DockerPodEngine } from '../pod-engine'

export type RecordedRequest = {
  method: string
  path: string
  query: Record<string, string>
  contentType: string | null
  text: string
  bytes: Uint8Array
}

export type Handler = (request: RecordedRequest) => Response | Promise<Response>

const cleanups: Array<() => Promise<void>> = []

export async function cleanupDaemons() {
  for (const cleanup of cleanups.splice(0)) await cleanup()
}

export async function serveDaemon(handler: Handler) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-pod-engine-'))
  const socketPath = join(directory, 'docker.sock')
  const requests: RecordedRequest[] = []
  const server = Bun.serve({
    unix: socketPath,
    async fetch(incoming) {
      const url = new URL(incoming.url)
      const bytes = new Uint8Array(await incoming.arrayBuffer())
      const recorded = {
        method: incoming.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        contentType: incoming.headers.get('content-type'),
        text: new TextDecoder().decode(bytes),
        bytes,
      }
      requests.push(recorded)
      return await handler(recorded)
    },
  })
  cleanups.push(async () => {
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  })
  return { engine: new DockerPodEngine({ socketPath }), requests }
}
