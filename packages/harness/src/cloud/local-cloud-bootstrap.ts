import type { ThreadId } from '@dltech/atlas-core'

import { SANDBOX_HOME_PATH, type VercelSandboxConfig } from '@dltech/atlas-wire'
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
