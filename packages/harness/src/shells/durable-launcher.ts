import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  EExecutionLocation,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { IMPORTED_SHELL_ORIGIN, IMPORTED_SHELL_ORIGIN_FILE } from '../cloud/portable-session-file'
import { atlasBinDirectory } from '../store/paths'
import { LOGIN_ENV_MARKER } from '../execution/login-env-process'
import { ATLAS_SHELL_DIR_ENV } from '../hooks/thread-environment'
import type { SessionRegistry } from '../store/sessions/registry'
import {
  attachDurableShell,
  launchDurableShell,
  CONTROL_FLAG,
  EAttachFailure,
  type ControlAction,
  type ControlResult,
  type ControlTransport,
} from './durable/client'
import { EControlError } from './durable/protocol'
import {
  EInspected,
  ShellLauncherPort,
  type InspectedShell,
  type ShellLaunchOutcome,
  type ShellLaunchSpec,
} from './port'
import { toShellId } from './shell-id'
import { shellFiles, shellsDirectory, type CreatedShell, type ShellStorage } from './storage'
import { pidNamespaceOf } from './durable/identity'
import { supervisorCommand, type SupervisorLauncher } from './supervisor-launch'
import { attachmentOf, exitOf, sizeOf } from './durable-attachment'

export type DurableLauncherDeps = {
  storage: ShellStorage
  sessions: Pick<SessionRegistry, 'sessionDirOf'>
  processes: ProcessPort
  supervisor: () => Promise<SupervisorLauncher>
  locationOf?: ((threadId: ThreadId) => EExecutionLocation | undefined) | undefined
  now: () => string
}

const shellEnv = (directory: string): Record<string, string | undefined> => ({
  ...process.env,
  PATH: `${atlasBinDirectory()}:${process.env.PATH ?? ''}`,
  [LOGIN_ENV_MARKER]: '1',
  [ATLAS_SHELL_DIR_ENV]: directory,
})

const isControlResult = (value: unknown): value is ControlResult =>
  typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'

export class DurableShellLauncher extends ShellLauncherPort {
  constructor(private readonly deps: DurableLauncherDeps) {
    super()
  }

  async launch(spec: ShellLaunchSpec): Promise<ShellLaunchOutcome> {
    const { deps } = this
    let created: CreatedShell
    let prefix: SupervisorLauncher
    try {
      created = await deps.storage.create({ threadId: spec.threadId })
      prefix = await deps.supervisor()
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }

    const docker = this.docker(spec.threadId)
    const command = supervisorCommand({ launcher: prefix, docker, configPath: '' }).slice(0, -1)
    const env = shellEnv(created.directory)
    const outcome = await launchDurableShell({
      shellDir: created.directory,
      command: spec.command,
      cwd: spec.cwd,
      env,
      timeoutMs: spec.timeoutMs,
      silenceMs: spec.silenceMs,
      outputLimitBytes: spec.outputLimitBytes,
      supervisorCommand: command,
      sessionLock: docker
        ? undefined
        : { lockFile: created.sessionLock, pidNamespace: await pidNamespaceOf() },
      transport: docker ? this.transport({ command, threadId: spec.threadId, dir: created.directory }) : undefined,
      launch: async (call) => {
        if (deps.processes.launchDetached === undefined) {
          throw new Error('the process port this thread runs on cannot launch detached commands')
        }
        await deps.processes.launchDetached({ ...call, threadId: spec.threadId })
      },
    })
    if (!outcome.ok) return { ok: false, reason: outcome.reason }
    return {
      ok: true,
      attachment: attachmentOf({
        handle: outcome.handle,
        files: created,
        shellId: created.shellId,
        startedAt: deps.now(),
      }),
    }
  }

  async inspect(args: { threadId: ThreadId }): Promise<readonly InspectedShell[]> {
    const sessionDir = await this.deps.sessions.sessionDirOf({ threadId: args.threadId })
    if (sessionDir === undefined) return []
    const names = await readdir(shellsDirectory({ sessionDir, threadId: args.threadId })).catch(() => [])
    const inspected: InspectedShell[] = []
    for (const name of names) {
      const found = await this.inspectOne({ sessionDir, threadId: args.threadId, name })
      if (found !== undefined) inspected.push(found)
    }
    return inspected
  }

  private async inspectOne(args: {
    sessionDir: string
    threadId: ThreadId
    name: string
  }): Promise<InspectedShell | undefined> {
    const shellId = toShellId(args.name)
    const files = shellFiles({ sessionDir: args.sessionDir, threadId: args.threadId, shellId })
    const imported = importedFrom(files.directory)
    const attached = await attachDurableShell({
      shellDir: files.directory,
      cursor: sizeOf(files.output),
      transport: imported ? importedTransport : this.control({ threadId: args.threadId, dir: files.directory }).transport,
    }).catch((error: unknown) => ({ ok: false as const, code: EAttachFailure.Invalid, reason: String(error) }))

    if (!attached.ok) {
      if (attached.code === EAttachFailure.Missing) return undefined
      return { state: EInspected.Corrupt, shellId, reason: attached.reason }
    }
    const { handle } = attached
    const snapshot = handle.snapshot()
    const status = await handle.status()
    const startedAt = new Date(status?.startedAt ?? 0).toISOString()
    const attachment = attachmentOf({ handle, files, shellId, startedAt })
    if (snapshot.exit !== undefined) {
      const exit = exitOf({ exit: snapshot.exit, killedBy: undefined, endedAt: new Date(snapshot.exit.endedAt).toISOString() })
      return { state: EInspected.Finished, shellId, attachment, exit }
    }
    if (snapshot.lostReason !== undefined) {
      await handle.detach()
      return undefined
    }
    return { state: EInspected.Live, shellId, attachment }
  }

  private docker(threadId: ThreadId): boolean {
    return this.deps.locationOf?.(threadId) === EExecutionLocation.Docker
  }

  private control(args: { threadId: ThreadId; dir: string }): { transport?: ControlTransport } {
    if (!this.docker(args.threadId)) return {}
    return { transport: this.transport({ ...args, command: [] }) }
  }

  private transport(args: { threadId: ThreadId; dir: string; command: readonly string[] }): ControlTransport {
    return async ({ request }) => this.sendInContainer({ ...args, request })
  }

  private async sendInContainer(args: {
    threadId: ThreadId
    dir: string
    command: readonly string[]
    request: ControlAction
  }): Promise<ControlResult> {
    try {
      const prefix =
        args.command.length > 0 ? args.command : supervisorCommand({
          launcher: await this.deps.supervisor(),
          docker: true,
          configPath: '',
        }).slice(0, -1)
      const handle = this.deps.processes.spawn({
        cmd: [...prefix, CONTROL_FLAG, args.dir, JSON.stringify(args.request)],
        cwd: args.dir,
        threadId: args.threadId,
      })
      const [text] = await Promise.all([new Response(handle.stdout).text(), handle.exited])
      const parsed: unknown = JSON.parse(text.trim().split('\n').at(-1) ?? '')
      if (isControlResult(parsed)) return parsed
      return { ok: false, code: EControlError.Unreachable, message: 'the control helper answered nothing usable' }
    } catch (error) {
      return { ok: false, code: EControlError.Unreachable, message: error instanceof Error ? error.message : String(error) }
    }
  }
}

const foreignPidsOutOfReach: ControlResult = {
  ok: false,
  code: EControlError.Unreachable,
  message: 'the shell was imported from another machine, so its recorded pids do not name local processes',
}

const importedTransport: ControlTransport = () => Promise.resolve(foreignPidsOutOfReach)

function importedFrom(directory: string): boolean {
  try {
    return readFileSync(join(directory, IMPORTED_SHELL_ORIGIN_FILE), 'utf8').trim() === IMPORTED_SHELL_ORIGIN
  } catch {
    return false
  }
}
