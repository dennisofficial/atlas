import {
  ProcessPort,
  type PortExposureOutcome,
  type ProcessHandle,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'

import { signalGroup, type LocalProcessHandle, type LocalProcessPort } from './local-process'

export const LOGIN_ENV_MARKER = 'ATLAS_RESOLVE_LOGIN_ENV'

const RUN_COMMAND_THEN_REPLACE = 'exec bash -c "$ATLAS_SHELL_COMMAND"'
const SIGTERM_RETRY_MS = 300

/**
 * Toolchain managers (fnm, direnv, corepack) install their resolution hooks in the interactive
 * rc files, which a plain `bash -c` never reads — so a spawned command would see whatever
 * versions were on PATH when this process launched, frozen there. Booting the user's login shell
 * first and letting it hand off to bash reproduces exactly what their terminal resolves for the
 * spawn's cwd. zsh needs -i to read .zshrc; `bash -i` without a tty prints "no job control in
 * this shell" on stderr, so bash gets login-only flags, where .bash_profile is the hook
 * convention.
 */
const loginShellInvocation = (): { path: string; flags: string } => {
  const shell = process.env.SHELL ?? ''
  if (shell.endsWith('zsh')) return { path: shell, flags: '-ilc' }
  return { path: shell === '' ? 'bash' : shell, flags: '-lc' }
}

const throughLoginShell = (args: SpawnCommand): SpawnCommand => {
  const [interpreter, dashC, command] = args.cmd
  if (interpreter !== 'bash' || dashC !== '-c' || command === undefined || args.cmd.length !== 3) {
    return args
  }

  const login = loginShellInvocation()
  const env: Record<string, string | undefined> = { ...args.env, ATLAS_SHELL_COMMAND: command }
  delete env[LOGIN_ENV_MARKER]
  // FNM_LOGLEVEL arrives via fnm env's own default export, not a user choice; an explicit
  // `--log-level` in the rc files still wins because that eval runs after this env is set.
  env.FNM_LOGLEVEL = 'quiet'
  return { ...args, cmd: [login.path, login.flags, RUN_COMMAND_THEN_REPLACE], env }
}

/**
 * Host-side decorator: shells the model asks for are marked with LOGIN_ENV_MARKER (see
 * shells/shell-process.ts), and only those are rerouted through the user's login shell. Sandboxed
 * execution never passes through here — a container's toolchain comes from its image, not from
 * the host's rc files.
 */
export class LoginEnvProcessPort implements ProcessPort {
  constructor(private readonly inner: LocalProcessPort) {}

  spawn(args: SpawnCommand): ProcessHandle {
    if (args.env?.[LOGIN_ENV_MARKER] === undefined) return this.inner.spawn(args)
    return this.withStartupKillRetry(this.inner.spawn(throughLoginShell(args)))
  }

  /**
   * An interactive zsh defers SIGTERM while its rc files are still running (measured: a TERM sent
   * 150ms into a ~200ms startup is never delivered; at 600ms it kills as usual). A kill that
   * lands in that window would otherwise wait for the 5s SIGKILL grace, so terminate re-sends
   * TERM on a short interval until the process exits; the inner handle's SIGKILL escalation is
   * unchanged as the backstop.
   */
  private withStartupKillRetry(handle: LocalProcessHandle): ProcessHandle {
    let terminating = false
    let retry: ReturnType<typeof setInterval> | undefined

    return {
      ...handle,
      terminate: () => {
        if (terminating) return
        terminating = true
        handle.terminate()
        const group = { pid: handle.pid, kill: () => undefined }
        retry = setInterval(() => signalGroup({ child: group, signal: 'SIGTERM' }), SIGTERM_RETRY_MS)
        retry.unref()
        void handle.exited.then(() => {
          if (retry !== undefined) clearInterval(retry)
          retry = undefined
        })
      },
    }
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
}
