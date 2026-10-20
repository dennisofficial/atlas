import { logFieldsOf } from '@dltech/atlas-harness'

import { registerGrammars } from '../ui/markdown/grammars/index'
import { EBootStep, type BootProgress } from './boot-progress'
import { durableOpLog } from './durable-op-log'
import { composeAtlas, type AtlasApp } from './compose'
import type { AtlasConfig } from './config'
import { diagnoseCredentialFailure, type CredentialDiagnosis } from './credential-diagnosis'
import { noticePortBinding } from './notice-binding'
import { openConversation, unstartedConversation, type OpenedConversation } from './open-conversation'
import { type SettingsBinding } from '@dltech/atlas-harness'
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

  progress.report(EBootStep.Composing)
  const app = await composeAtlas({
    config,
    command: args.command,
    env: args.env,
    settings: args.settings,
  })

  progress.report(EBootStep.Authorising)
  const readiness = await credentialReadiness(app)

  // @opentui/core's first Tree-sitter client takes the default parser set as it finds it, so a
  // grammar registered after the tree mounts never reaches it — and a missing grammar only warns.
  progress.report(EBootStep.Highlighting)
  await registerGrammars()

  progress.report(EBootStep.Opening)
  const outcome = await openConversation({
    threads: app.threads,
    log: app.log,
    ledger: app.ledger,
    ids: app.ids,
    workspace: app.workspace,
    open: config.open,
    effects: (name) => app.tools.find(name)?.effect,
    boot: true,
  })

  if ('cloud' in outcome) {
    progress.report(EBootStep.Ready)
    return {
      type: ESession.Ready,
      app,
      opened: unstartedConversation({ ids: app.ids, bootCloudThreadId: outcome.threadId }),
      credentialNotice: readiness?.message ?? null,
    }
  }
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
  return startSession(args).catch((error: unknown) => {
    durableOpLog()?.error({
      source: 'tui.open-session',
      message: 'session startup failed',
      ...logFieldsOf({ error }),
      data: { command: args.command, cwd: args.config.cwd },
    })
    return { type: ESession.Failed, error } as const
  })
}
