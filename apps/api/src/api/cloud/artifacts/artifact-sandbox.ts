import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'

export const ARTIFACT_BUILD_CLAMP_MS = 180_000

export const ARTIFACT_WORKSPACE = '/workspace'

export const ARTIFACT_SANDBOX_STOP_TIMEOUT_MS = 30_000

const ARTIFACT_IMAGE_PATH = '/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin'

/** The only environment a build may see: the sandbox image's, never a credential from this process. */
export const artifactBuildEnv = (): Record<string, string> => ({
  CI: '1',
  NODE_ENV: 'production',
  HOME: ARTIFACT_WORKSPACE,
  PATH: ARTIFACT_IMAGE_PATH,
})

export interface ArtifactSandboxFile {
  path: string
  content: Buffer
}

export interface ArtifactSandboxCommand {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface ArtifactSandboxRequest {
  owner: ArtifactBuildOwner
  files: readonly ArtifactSandboxFile[]
  install: string | undefined
  cmd: string
  outDir: string
  env: Record<string, string>
  timeoutMs: number
}

export interface ArtifactSandboxResult {
  install: ArtifactSandboxCommand | null
  build: ArtifactSandboxCommand | null
  outDir: readonly ArtifactSandboxFile[]
}

export type ArtifactBuildOwner = { threadId: string } | { userId: string }

export const buildCredentialsOf = (args: {
  credentials: SandboxCredentials
  owner: ArtifactBuildOwner
}) =>
  'threadId' in args.owner
    ? args.credentials.forThread({ threadId: args.owner.threadId })
    : args.credentials.forUser({ userId: args.owner.userId })

export abstract class ArtifactSandbox {
  abstract run(request: ArtifactSandboxRequest): Promise<ArtifactSandboxResult>
}
