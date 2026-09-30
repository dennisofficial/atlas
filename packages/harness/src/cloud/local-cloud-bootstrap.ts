import type { ThreadId } from '@dltech/atlas-core'
import type { PortableState } from '@dltech/atlas-wire'

import { DRIVE_HOME_PATH } from './drive-names'
import { ECloudSandboxState } from './sandbox-client'
import { VercelDriver, type VercelSandboxConfig } from './vercel-driver'
import type { CloudSandboxes, LiftedWorkspace } from './relocation/cloud-bridge'

export type LiveSandbox = Parameters<
  NonNullable<Parameters<VercelDriver['createOrResume']>[0]['putContextOnFreshBoot']>
>[0]

export type BridgeDriver = Pick<
  VercelDriver,
  | 'createOrResume'
  | 'inspect'
  | 'writeBootstrapFileToSandbox'
  | 'writeBootstrapFile'
  | 'transcriptLanded'
  | 'destroy'
>

export const BOOTSTRAP_DIRECTORY = `${DRIVE_HOME_PATH}/bootstrap`
export const WORKSPACE_SPEC_PATH = `${BOOTSTRAP_DIRECTORY}/workspace-spec.json`
export const CONTEXT_ARCHIVE_PATH = `${BOOTSTRAP_DIRECTORY}/context.tar.gz`
export const TRANSCRIPT_ARCHIVE_PATH = `${BOOTSTRAP_DIRECTORY}/transcript.tar.gz`
export const VAULT_PROBE_PATH = `${DRIVE_HOME_PATH}/auth.json`

export type GitTokenReader = () => Promise<string>

export type PortableOmissions = {
  oauthAccounts: readonly string[]
  mcpOauthSecrets: readonly string[]
}

export const portableOmissionsOf = (state: PortableState | undefined): PortableOmissions | null => {
  if (state?.omitted === undefined) return null
  if (state.omitted.oauthAccounts.length === 0 && state.omitted.mcpOauthSecrets.length === 0) {
    return null
  }
  return {
    oauthAccounts: state.omitted.oauthAccounts,
    mcpOauthSecrets: state.omitted.mcpOauthSecrets,
  }
}

export type SandboxRegistration = (args: {
  threadId: ThreadId
}) =>
  | { metadata?: { title?: string; repo?: string; model?: string } | undefined }
  | Promise<{ metadata?: { title?: string; repo?: string; model?: string } | undefined } | undefined>
  | undefined

export type RegistrationSender = (args: {
  registration: {
    threadId: ThreadId
    token: string
    serveUrl: string
    driveName: string
    metadata?: { title?: string; repo?: string; model?: string } | undefined
  }
}) => unknown

export const bootstrapSpecOf = (args: {
  workspace: LiftedWorkspace | null
  gitToken: string | undefined
  gpgKey?: string | undefined
  model?: string | undefined
}): string =>
  JSON.stringify({
    remoteUrl: args.workspace?.remoteUrl ?? null,
    branch: args.workspace?.branch ?? null,
    commit: args.workspace?.commit ?? null,
    patch: args.workspace?.patch ?? '',
    githubToken: args.gitToken ?? null,
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.workspace?.gitIdentity === undefined || args.workspace?.gitIdentity === null
      ? {}
      : { gitIdentity: args.workspace.gitIdentity }),
    ...(args.gpgKey === undefined ? {} : { gpgKey: args.gpgKey }),
    ...(args.workspace?.projectDirectory === undefined ||
    args.workspace?.projectDirectory === null
      ? {}
      : { projectDirectory: args.workspace.projectDirectory }),
  })

export const parkedEscalationOf = (args: {
  sandboxes: Pick<CloudSandboxes, 'find'>
  threadId: ThreadId
}): (() => Promise<boolean>) => {
  const { sandboxes, threadId } = args
  return () =>
    sandboxes.find({ threadId }).then(
      (status) => status?.state === ECloudSandboxState.Parked,
      () => false,
    )
}

export const liveDriverWith = (args: {
  config: VercelSandboxConfig
  onDriverLog?: ((line: string) => void) | undefined
}): BridgeDriver =>
  new VercelDriver({
    credentials: args.config.credentials,
    cloudUrl: '',
    image: args.config.image,
    ...(args.config.serveVersion === undefined ? {} : { serveVersion: args.config.serveVersion }),
    ...(args.onDriverLog === undefined ? {} : { log: args.onDriverLog }),
  })

const QUICK_COMMAND_TIMEOUT_MS = 15_000

export const vaultPresentInSandbox = async (sandbox: LiveSandbox): Promise<boolean> => {
  try {
    const probe = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `test -s ${VAULT_PROBE_PATH}`],
      timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
    })
    return probe.exitCode === 0
  } catch {
    return false
  }
}
