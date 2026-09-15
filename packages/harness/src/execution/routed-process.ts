import {
  EExecutionLocation,
  ProcessPort,
  type PortExposureOutcome,
  type ProcessHandle,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'

const withoutNodeEnv = (
  env: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> | undefined => {
  if (env === undefined || !('NODE_ENV' in env)) return env

  const stripped = { ...env }
  delete stripped['NODE_ENV']
  return stripped
}

export class RoutedProcessPort implements ProcessPort {
  private readonly local: ProcessPort
  private readonly dockerFor: () => ProcessPort
  private readonly locationOf: (threadId: ThreadId | undefined) => EExecutionLocation
  private docker: ProcessPort | undefined

  constructor(args: {
    local: ProcessPort
    docker: () => ProcessPort
    locationOf: (threadId: ThreadId | undefined) => EExecutionLocation
  }) {
    this.local = args.local
    this.dockerFor = args.docker
    this.locationOf = args.locationOf
  }

  spawn(args: SpawnCommand): ProcessHandle {
    if (this.locationOf(args.threadId) !== EExecutionLocation.Docker) {
      return this.local.spawn(args)
    }

    this.docker ??= this.dockerFor()
    return this.docker.spawn({ ...args, env: withoutNodeEnv(args.env) })
  }

  which(args: { command: string; threadId?: ThreadId | undefined }): string | null {
    return this.portFor(args.threadId).which(args)
  }

  async vendored(args: { command: string; threadId?: ThreadId | undefined }): Promise<string | null> {
    const port = this.portFor(args.threadId)
    if (port.vendored === undefined) return null
    return await port.vendored(args)
  }

  async exposePort(args: {
    containerPort: number
    threadId?: ThreadId | undefined
  }): Promise<PortExposureOutcome> {
    const port = this.portFor(args.threadId)
    if (port.exposePort === undefined) {
      return { ok: false, reason: 'the port this thread runs on cannot expose ports' }
    }

    return await port.exposePort(args)
  }

  private portFor(threadId: ThreadId | undefined): ProcessPort {
    if (this.locationOf(threadId) !== EExecutionLocation.Docker) return this.local

    this.docker ??= this.dockerFor()
    return this.docker
  }
}
