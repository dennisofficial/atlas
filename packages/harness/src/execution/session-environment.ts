import { lstat, mkdir } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'

import {
  ProcessPort,
  type PortExposureOutcome,
  type ProcessHandle,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'

import { contextDirectory, imagesDirectory, threadDataDirectory } from '../store/sessions/paths'
import type { SessionRegistry } from '../store/sessions/registry'

export const ATLAS_SESSION_DIR_ENV = 'ATLAS_SESSION_DIR'
export const ATLAS_THREAD_DIR_ENV = 'ATLAS_THREAD_DIR'
export const ATLAS_CONTEXT_DIR_ENV = 'ATLAS_CONTEXT_DIR'

export const RESERVED_SESSION_ENV: readonly string[] = [
  ATLAS_SESSION_DIR_ENV,
  ATLAS_THREAD_DIR_ENV,
  ATLAS_CONTEXT_DIR_ENV,
]
export const PRIVATE_DIRECTORY_MODE = 0o700
const TERMINATED_BEFORE_START = 143
const COULD_NOT_START = 127

type Environment = Record<string, string | undefined>

export type SessionPaths = { sessionDir: string; threadDir: string; contextDir: string; imagesDir: string }

type ChunkReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>
  cancel(reason?: unknown): Promise<void>
}

type SpawnedHandle = ProcessHandle & { readonly pid?: number | undefined }

export const withoutReservedSessionEnv = (env: Environment): Environment => {
  if (!RESERVED_SESSION_ENV.some((key) => key in env)) return env
  const stripped = { ...env }
  for (const key of RESERVED_SESSION_ENV) delete stripped[key]
  return stripped
}

const withPaths = ({ env, paths }: { env: Environment; paths: SessionPaths | undefined }): Environment =>
  paths === undefined
    ? env
    : {
        ...env,
        [ATLAS_SESSION_DIR_ENV]: paths.sessionDir,
        [ATLAS_THREAD_DIR_ENV]: paths.threadDir,
        [ATLAS_CONTEXT_DIR_ENV]: paths.contextDir,
      }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      if (text !== '') controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

const failedHandle = (message: string): SpawnedHandle => ({
  stdout: streamOf(''),
  stderr: streamOf(`${message}\n`),
  exited: Promise.resolve(COULD_NOT_START),
  terminate: () => undefined,
})

export async function ensurePrivateDirectory({
  anchor,
  directory,
}: {
  anchor: string
  directory: string
}): Promise<void> {
  const segments = relative(anchor, directory).split(sep)
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${directory} is not inside ${anchor}`)
  }

  let current = anchor
  for (const segment of segments) {
    current = `${current}${sep}${segment}`
    await mkdir(current, { mode: PRIVATE_DIRECTORY_MODE }).catch((error: unknown) => {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error
    })
    const stats = await lstat(current)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`${current} must be a plain directory, not a symlink or file`)
    }
  }
}

export class SessionEnvironmentProcessPort implements ProcessPort {
  private readonly inner: ProcessPort
  private readonly sessions: Pick<SessionRegistry, 'sessionDirOf'>
  private readonly reachable: (threadId: ThreadId | undefined) => boolean
  private readonly resolved = new Map<ThreadId, SessionPaths>()

  constructor(args: {
    inner: ProcessPort
    sessions: Pick<SessionRegistry, 'sessionDirOf'>
    reachable?: ((threadId: ThreadId | undefined) => boolean) | undefined
  }) {
    this.inner = args.inner
    this.sessions = args.sessions
    this.reachable = args.reachable ?? (() => true)
  }

  async prepare({ threadId }: { threadId: ThreadId }): Promise<SessionPaths> {
    const cached = this.resolved.get(threadId)
    if (cached !== undefined) return cached

    const sessionDir = await this.sessions.sessionDirOf({ threadId })
    if (sessionDir === undefined) {
      throw new Error(`thread ${threadId} is not registered in any session, so it has no session directory`)
    }

    const threadDir = threadDataDirectory({ sessionDir, threadId })
    const contextDir = contextDirectory({ sessionDir })
    const imagesDir = imagesDirectory({ sessionDir })
    await ensurePrivateDirectory({ anchor: dirname(sessionDir), directory: threadDir })
    await ensurePrivateDirectory({ anchor: sessionDir, directory: contextDir })
    await ensurePrivateDirectory({ anchor: sessionDir, directory: imagesDir })
    const paths: SessionPaths = { sessionDir, threadDir, contextDir, imagesDir }
    this.resolved.set(threadId, paths)
    return paths
  }

  forget({ threadId }: { threadId: ThreadId }): void {
    this.resolved.delete(threadId)
  }

  spawn(args: SpawnCommand): ProcessHandle {
    const { threadId } = args
    if (threadId === undefined || !this.reachable(threadId)) {
      return this.inner.spawn(this.unscoped(args))
    }

    const cached = this.resolved.get(threadId)
    if (cached !== undefined) return this.inner.spawn(this.scoped({ args, paths: cached }))

    return this.spawnAfterPrepare({ args, threadId })
  }

  async launchDetached(args: SpawnCommand): Promise<void> {
    if (this.inner.launchDetached === undefined) {
      throw new Error('the process port this thread runs on cannot launch detached commands')
    }

    const { threadId } = args
    if (threadId === undefined || !this.reachable(threadId)) {
      return await this.inner.launchDetached(this.unscoped(args))
    }
    await this.inner.launchDetached(this.scoped({ args, paths: await this.prepare({ threadId }) }))
  }

  which(args: { command: string; threadId?: ThreadId | undefined }): string | null {
    return this.inner.which(args)
  }

  async vendored(args: { command: string; threadId?: ThreadId | undefined }): Promise<string | null> {
    if (this.inner.vendored === undefined) return null
    return await this.inner.vendored(args)
  }

  async exposePort(args: {
    containerPort: number
    threadId?: ThreadId | undefined
  }): Promise<PortExposureOutcome> {
    if (this.inner.exposePort === undefined) {
      return { ok: false, reason: 'the port this thread runs on cannot expose ports' }
    }
    return await this.inner.exposePort(args)
  }

  private unscoped(args: SpawnCommand): SpawnCommand {
    return args.env === undefined ? args : { ...args, env: withoutReservedSessionEnv(args.env) }
  }

  private scoped({ args, paths }: { args: SpawnCommand; paths: SessionPaths }): SpawnCommand {
    const env = withoutReservedSessionEnv(args.env ?? process.env)
    return { ...args, env: withPaths({ env, paths }) }
  }

  private spawnAfterPrepare({ args, threadId }: { args: SpawnCommand; threadId: ThreadId }): ProcessHandle {
    let terminated = false

    const started: Promise<SpawnedHandle | undefined> = this.prepare({ threadId }).then(
      (paths) => {
        if (terminated) return undefined
        try {
          return this.inner.spawn(this.scoped({ args, paths }))
        } catch (error) {
          return failedHandle(messageOf(error))
        }
      },
      (error: unknown) =>
        failedHandle(`could not prepare the session directories for thread ${threadId}: ${messageOf(error)}`),
    )

    const forward = (pick: 'stdout' | 'stderr'): ReadableStream<Uint8Array> => {
      let reader: ChunkReader | undefined
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          const handle = await started
          if (handle === undefined) return controller.close()
          const active: ChunkReader = reader ?? handle[pick].getReader()
          reader = active
          const chunk = await active.read()
          if (chunk.done) return controller.close()
          controller.enqueue(chunk.value)
        },
        async cancel(reason) {
          const handle = await started
          await (reader ?? handle?.[pick])?.cancel(reason)
        },
      })
    }

    let live: SpawnedHandle | undefined
    void started.then((handle) => {
      live = handle
    })

    return {
      stdout: forward('stdout'),
      stderr: forward('stderr'),
      exited: started.then((handle) => handle?.exited ?? TERMINATED_BEFORE_START),
      terminate: () => {
        terminated = true
        live?.terminate()
      },
      get pid() {
        return live?.pid
      },
    } as SpawnedHandle
  }
}
