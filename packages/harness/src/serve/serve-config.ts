import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { EServeEnv } from '@dltech/atlas-wire'

export { EServeEnv }

export const DEFAULT_SERVE_PORT = 3000

const MAX_PORT = 65_535

export class ServeNeedsConfiguration extends Error {
  readonly variable: EServeEnv

  constructor(args: { variable: EServeEnv; detail: string }) {
    super(`atlas serve ${args.detail}: pass it, or set ${args.variable}`)
    this.name = 'ServeNeedsConfiguration'
    this.variable = args.variable
  }
}

export type ServeConfig = {
  threadId: ThreadId
  port: number
  token: string
  controlPlaneUrl: string
  cwd: string
}

const given = (value: string | undefined): string | undefined =>
  value === undefined || value.trim().length === 0 ? undefined : value.trim()

const portFrom = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined

  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new ServeNeedsConfiguration({
      variable: EServeEnv.Port,
      detail: 'was given a port that is not a port number',
    })
  }
  return port
}

export function serveConfig(args: {
  env: Record<string, string | undefined>
  threadId?: ThreadId | undefined
  port?: number | undefined
  token?: string | undefined
  controlPlaneUrl?: string | undefined
  cwd?: string | undefined
}): ServeConfig {
  const { env } = args

  const token = args.token ?? given(env[EServeEnv.Token])
  if (token === undefined) {
    throw new ServeNeedsConfiguration({
      variable: EServeEnv.Token,
      detail: 'has no session token to authenticate clients against',
    })
  }

  const thread = args.threadId ?? given(env[EServeEnv.ThreadId])
  if (thread === undefined) {
    throw new ServeNeedsConfiguration({
      variable: EServeEnv.ThreadId,
      detail: 'was not told which thread it serves',
    })
  }

  const controlPlaneUrl = args.controlPlaneUrl ?? given(env[EServeEnv.CloudUrl])
  if (controlPlaneUrl === undefined) {
    throw new ServeNeedsConfiguration({
      variable: EServeEnv.CloudUrl,
      detail: 'has no Atlas Cloud API to read the durable log from',
    })
  }

  return {
    threadId: toThreadId(thread),
    port: args.port ?? portFrom(given(env[EServeEnv.Port])) ?? DEFAULT_SERVE_PORT,
    token,
    controlPlaneUrl,
    cwd: args.cwd ?? given(env[EServeEnv.WorkspaceDir]) ?? process.cwd(),
  }
}
