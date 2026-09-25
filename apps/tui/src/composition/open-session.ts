import { existsSync } from 'node:fs'

import {
  DEFAULT_DOCKER_SOCKET,
  DockerEngine,
  listWorktrees,
  sweepSandboxes,
} from '@dltech/atlas-harness'

import { registerGrammars } from '../ui/markdown/grammars/index'
import { clientVersionHeader } from '../build/info'
import { ENoticeTone, notify } from '../ui/notice-store'
import { EBootStep, type BootProgress } from './boot-progress'
import { composeAtlas, type AtlasApp } from './compose'
import type { AtlasConfig } from './config'
import { diagnoseCredentialFailure, type CredentialDiagnosis } from './credential-diagnosis'
import { mergeRemoteMemoryBounded } from './cloud/bounded-merge-remote-memory'
import { openConversation, type OpenedConversation } from './open-conversation'
import {
  RemoteThreadStore,
  SessionsClient,
  type SettingsBinding,
  type ThreadStorePort,
} from '@dltech/atlas-harness'
import { stateOfDirectory, workspaceRefusal } from './workspace-directory'

const REFUSED = 1

export enum ESession {
  Ready = 'ready',
  Refused = 'refused',
  Failed = 'failed',
}

export type Session =
  | {
      type: ESession.Ready
      app: AtlasApp
      opened: OpenedConversation
      credentialNotice: string | null
    }
  | { type: ESession.Refused; message: string; exitCode: number }
  | { type: ESession.Failed; error: unknown }

/**
 * The boot-time credential read is a probe for what the operator should be told, never a gate:
 * anything diagnosable — a missing account, an expired token, a cloud outage — rides into the
 * session as a notice and the first real turn surfaces the same failure with its advice. The old
 * behaviour exited Atlas over a 504, which the outage advice itself ("local work still works")
 * contradicted the moment the process died. The probe is bounded so a cloud that hangs rather
 * than answers cannot hold boot open either.
 */
const CREDENTIAL_PROBE_TIMEOUT_MS = 5_000

async function credentialReadiness(app: AtlasApp): Promise<CredentialDiagnosis | null> {
  const probe = app.credentials.read()
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), CREDENTIAL_PROBE_TIMEOUT_MS),
  )

  try {
    await Promise.race([probe, timeout])
    return null
  } catch (error) {
    const diagnosis = diagnoseCredentialFailure(error)
    if (diagnosis === null) throw error
    return diagnosis
  }
}

async function sweepOrphanedSandboxes(args: { cwd: string }): Promise<void> {
  const socketPath = process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET
  if (!existsSync(socketPath)) return

  const listing = await listWorktrees({ cwd: args.cwd })
  if (!listing.ok) return

  const removed = await sweepSandboxes({
    engine: new DockerEngine({ socketPath }),
    worktrees: listing.worktrees.map((worktree) => worktree.path),
  })
  if (removed.length === 0) return

  notify({
    key: 'sandbox-sweep',
    tone: ENoticeTone.Info,
    text: `Removed ${removed.length} sandbox ${removed.length === 1 ? 'container' : 'containers'} whose ${removed.length === 1 ? 'worktree is' : 'worktrees are'} gone: ${removed.join(', ')}`,
  })
}

const remoteThreadsOf = (app: AtlasApp): ThreadStorePort | undefined => {
  const signedIn = app.cloud.session()
  if (signedIn === null) return undefined

  return new RemoteThreadStore({
    client: new SessionsClient({
      url: signedIn.url,
      token: signedIn.token,
      clientVersion: clientVersionHeader(),
    }),
  })
}

async function startSession(args: {
  config: AtlasConfig
  command: string
  env: Record<string, string | undefined>
  progress: BootProgress
  settings: SettingsBinding
}): Promise<Session> {
  const { config, progress } = args

  const unusable = workspaceRefusal({
    directory: config.cwd,
    state: stateOfDirectory(config.cwd),
  })
  if (unusable !== null) return { type: ESession.Refused, message: unusable, exitCode: REFUSED }

  void sweepOrphanedSandboxes({ cwd: config.cwd }).catch(() => undefined)

  progress.report(EBootStep.Composing)
  const app = await composeAtlas({
    config,
    command: args.command,
    env: args.env,
    settings: args.settings,
  })

  const signedIn = app.cloud.session()
  if (signedIn !== null) {
    void mergeRemoteMemoryBounded({ session: signedIn, cwd: config.cwd })
  }

  progress.report(EBootStep.Authorising)
  const readiness = await credentialReadiness(app)

  // @opentui/core's first Tree-sitter client takes the default parser set as it finds it, so a
  // grammar registered after the tree mounts never reaches it — and a missing grammar only warns.
  progress.report(EBootStep.Highlighting)
  await registerGrammars()

  progress.report(EBootStep.Opening)
  const outcome = await openConversation({
    threads: app.threads,
    remoteThreads: remoteThreadsOf(app),
    log: app.log,
    ledger: app.ledger,
    agents: app.agents,
    ids: app.ids,
    workspace: app.workspace,
    open: config.open,
    effects: (name) => app.tools.find(name)?.effect,
  })

  if (!outcome.ok) {
    await app.close()
    return { type: ESession.Refused, message: outcome.reason, exitCode: REFUSED }
  }

  progress.report(EBootStep.Ready)
  return {
    type: ESession.Ready,
    app,
    opened: outcome.conversation,
    credentialNotice: readiness?.message ?? null,
  }
}

export function openSession(args: {
  config: AtlasConfig
  command: string
  env: Record<string, string | undefined>
  progress: BootProgress
  settings: SettingsBinding
}): Promise<Session> {
  return startSession(args).catch((error: unknown) => ({ type: ESession.Failed, error }) as const)
}
