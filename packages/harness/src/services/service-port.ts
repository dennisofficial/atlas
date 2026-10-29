import {
  deriveServicePort,
  nextServicePort,
  SERVICE_PORT_SPAN,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

export type PortProbe = (args: { port: number; threadId: ThreadId }) => Promise<boolean>

export function processPortProbe({ processes }: { processes: ProcessPort }): PortProbe {
  return async ({ port, threadId }) => {
    try {
      const handle = processes.spawn({
        cmd: ['bash', '-c', `exec 3<>/dev/tcp/127.0.0.1/${port}`],
        cwd: '/',
        threadId,
      })
      return (await handle.exited) !== 0
    } catch {
      return true
    }
  }
}

export async function allocateServicePort({
  threadId,
  name,
  declared,
  isFree,
}: {
  threadId: ThreadId
  name: string
  declared?: number | undefined
  isFree: PortProbe
}): Promise<number> {
  if (declared !== undefined) return declared

  let port = deriveServicePort({ threadId, name })
  for (let attempt = 0; attempt < SERVICE_PORT_SPAN; attempt += 1) {
    if (await isFree({ port, threadId })) return port
    port = nextServicePort({ port })
  }
  throw new Error(`no free port in the service range for ${name}`)
}
