import type { ThreadId } from '@dltech/atlas-core'

import { SANDBOX_HOME_PATH, type PortableState, type VercelSandboxConfig } from '@dltech/atlas-wire'
import { VercelDriver } from './vercel-driver'
import type { RunnerDriver } from './runner-driver'

export type LiveSandbox = Parameters<
  NonNullable<Parameters<VercelDriver['createOrResume']>[0]['putContextOnFreshBoot']>
>[0]

export type BridgeDriver = RunnerDriver<LiveSandbox> & {
  writeBootstrapFileToSandbox(args: {
    sandbox: LiveSandbox
    path: string
    content: Uint8Array | string
  }): Promise<void>
}

export const BOOTSTRAP_DIRECTORY = `${SANDBOX_HOME_PATH}/bootstrap`
export const WORKSPACE_SPEC_PATH = `${BOOTSTRAP_DIRECTORY}/workspace-spec.json`
export const CONTEXT_ARCHIVE_PATH = `${BOOTSTRAP_DIRECTORY}/context.tar.gz`
export const VAULT_PROBE_PATH = `${SANDBOX_HOME_PATH}/auth.json`

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
    serveVersion?: string | undefined
    metadata?: { title?: string; repo?: string; model?: string } | undefined
  }
}) => unknown

export const bootstrapSpecOf = (args: {
  projectId: string | null
  model?: string | undefined
}): string =>
  JSON.stringify({
    remoteUrl: null,
    githubToken: null,
    projectId: args.projectId,
    ...(args.model === undefined ? {} : { model: args.model }),
  })

export const liveDriverWith = (args: {
  config: VercelSandboxConfig
  onDriverLog?: ((line: string) => void) | undefined
  cloudUrl?: string | undefined
}): BridgeDriver =>
  new VercelDriver({
    credentials: args.config.credentials,
    cloudUrl: args.cloudUrl ?? '',
    image: args.config.image,
    ...(args.config.vcpus === undefined ? {} : { vcpus: args.config.vcpus }),
    ...(args.config.serveVersion === undefined ? {} : { serveVersion: args.config.serveVersion }),
    ...(args.config.devServe === undefined ? {} : { devServe: args.config.devServe }),
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
