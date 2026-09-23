import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  atlasHomeFrom,
  EPortExposure,
  isUnderPath,
  type EnvironmentCapabilities,
} from '@dltech/atlas-core'

import { runGit } from '../../workspace/run-git'
import type { GitReader } from '../../workspace/snapshot'

import {
  DEFAULT_DOCKER_SOCKET,
  DEFAULT_SANDBOX_IMAGE,
  type SandboxConfig,
  type SandboxLimits,
} from './sandbox'
import { EImageKind, type ContainerResolution } from '../image/resolve'
import type { DockerfileBuild } from '../image/build'
import { EMountMode, type Mount } from '../image/mounts'
import { mountsWithGitMetadata } from './git-metadata-mounts'

export type HostSandboxEnvironment = {
  uid: number
  gid: number
  home: string
  sshAuthSock?: string | undefined
  sshKnownHostsPath?: string | undefined
  gpgAgentExtraSocket?: string | undefined
  gpgPubringPath?: string | undefined
  gitconfigPath?: string | undefined
  githubToken?: string | undefined
}

const gpgAgentExtraSocket = (env: Record<string, string | undefined>): string | undefined => {
  const gpgconf = Bun.which('gpgconf', env.PATH === undefined ? undefined : { PATH: env.PATH })
  if (gpgconf === null) return undefined

  const probed = Bun.spawnSync([gpgconf, '--list-dirs', 'agent-extra-socket'], { env })
  if (!probed.success) return undefined

  const path = new TextDecoder().decode(probed.stdout).trim()
  return path !== '' && statSync(path, { throwIfNoEntry: false })?.isSocket() ? path : undefined
}

const existingFilePath = (path: string): string | undefined =>
  statSync(path, { throwIfNoEntry: false })?.isFile() ? path : undefined

const githubToken = (env: Record<string, string | undefined>): string | undefined => {
  const gh = Bun.which('gh', env.PATH === undefined ? undefined : { PATH: env.PATH })
  if (gh === null) return undefined

  const probed = Bun.spawnSync([gh, 'auth', 'token'], { env })
  if (!probed.success) return undefined

  const token = new TextDecoder().decode(probed.stdout).trim()
  return token === '' ? undefined : token
}

const operatorIds = (): { uid: number; gid: number } => {
  if (process.getuid === undefined || process.getgid === undefined) {
    throw new Error('container mode needs a platform that has uid and gid')
  }
  return { uid: process.getuid(), gid: process.getgid() }
}

const containerHomeMatchingHostPath = (env: Record<string, string | undefined>): string =>
  env.HOME ?? homedir()

export function hostSandboxEnvironment(args?: {
  env?: Record<string, string | undefined>
}): HostSandboxEnvironment {
  const env = args?.env ?? process.env
  const home = containerHomeMatchingHostPath(env)

  const sshAuthSock = env.SSH_AUTH_SOCK
  const sshKnownHostsPath = join(home, '.ssh', 'known_hosts')
  const gitconfigPath = join(home, '.gitconfig')
  const gpgPubringPath = join(env.GNUPGHOME || join(home, '.gnupg'), 'pubring.kbx')
  const { uid, gid } = operatorIds()
  const gpgAgentSocket = gpgAgentExtraSocket(env)

  return {
    uid,
    gid,
    home,
    sshAuthSock:
      sshAuthSock !== undefined && existsSync(sshAuthSock) ? sshAuthSock : undefined,
    sshKnownHostsPath: existingFilePath(sshKnownHostsPath),
    gpgAgentExtraSocket: gpgAgentSocket,
    gpgPubringPath: gpgAgentSocket !== undefined ? existingFilePath(gpgPubringPath) : undefined,
    gitconfigPath: existsSync(gitconfigPath) ? gitconfigPath : undefined,
    githubToken: githubToken(env),
  }
}

const gitIdentityOf = (name: string | undefined, email: string | undefined): string | null => {
  if (name === undefined || email === undefined) return null
  return `${name} <${email}>`
}

const trimmedOutputOf = (run: { ok: boolean; stdout: string }): string | undefined => {
  if (!run.ok) return undefined
  const trimmed = run.stdout.trim()
  return trimmed === '' ? undefined : trimmed
}

export async function probeDockerCapabilities(args: {
  cwd: string
  env?: Record<string, string | undefined> | undefined
  read?: GitReader | undefined
}): Promise<EnvironmentCapabilities> {
  const host = hostSandboxEnvironment(args.env === undefined ? {} : { env: args.env })
  const read = args.read ?? runGit
  const [name, email] = await Promise.all([
    read({ args: ['config', 'user.name'], cwd: args.cwd }),
    read({ args: ['config', 'user.email'], cwd: args.cwd }),
  ])

  return {
    canPush: host.githubToken !== undefined,
    gitIdentity: gitIdentityOf(trimmedOutputOf(name), trimmedOutputOf(email)),
    gpgSigning: host.gpgAgentExtraSocket !== undefined,
    dockerAvailable: true,
    persistentFs: true,
    serviceTtlSeconds: null,
    portExposure: EPortExposure.Localhost,
    failures: [],
  }
}

const imageFieldsOf = (
  resolution: ContainerResolution,
): { image: string; dockerfile?: DockerfileBuild } => {
  if (resolution.image.kind === EImageKind.Image) return { image: resolution.image.reference }
  return {
    image: DEFAULT_SANDBOX_IMAGE,
    dockerfile: { path: resolution.image.path, context: resolution.image.context },
  }
}

// The atlas-home root itself must never become reachable by widening this list. Mounting only
// these named subtrees is what keeps auth.json, the vault key and harness.db out of the
// container — credentials never enter the sandbox. The subtrees mount read-write: a container
// session is the same agent with the same capabilities, so it saves memories and installs
// skills exactly as it would on the host.
export const ATLAS_HOME_MOUNTED_SUBTREES = [
  'memory',
  'skills',
  'agents',
  'projects',
  'services',
  'bin',
] as const

export function mountedAtlasHomeSubtrees(args: {
  worktree: string
  declared?: readonly Mount[] | undefined
  atlasHome?: string | undefined
}): readonly Mount[] {
  const atlasHome = args.atlasHome ?? atlasHomeFrom({ env: process.env, home: homedir() })
  const covered = [args.worktree, ...(args.declared ?? []).map((mount) => mount.path)]

  return ATLAS_HOME_MOUNTED_SUBTREES.map((name) => ({
    path: join(atlasHome, name),
    mode: EMountMode.ReadWrite,
  })).filter(
    (subtree) =>
      existsSync(subtree.path) &&
      !covered.some((root) => isUnderPath({ directory: root, path: subtree.path })),
  )
}

export function sandboxConfigFromHost(args: {
  worktree: string
  session: string
  limits: SandboxLimits
  image?: string | undefined
  resolution?: ContainerResolution | undefined
  labelPrefix?: string | undefined
  atlasHomeSubtrees?: readonly Mount[] | undefined
}): SandboxConfig {
  const host = hostSandboxEnvironment()

  const imageFields =
    args.resolution !== undefined
      ? imageFieldsOf(args.resolution)
      : { image: args.image ?? DEFAULT_SANDBOX_IMAGE }

  return {
    ...imageFields,
    worktree: args.worktree,
    session: args.session,
    uid: host.uid,
    gid: host.gid,
    home: host.home,
    limits: args.limits,
    dockerSocket: process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET,
    labelPrefix: args.labelPrefix,
    sshAuthSock: host.sshAuthSock,
    sshKnownHostsPath: host.sshKnownHostsPath,
    gpgAgentExtraSocket: host.gpgAgentExtraSocket,
    gpgPubringPath: host.gpgPubringPath,
    gitconfigPath: host.gitconfigPath,
    githubToken: host.githubToken,
    setup: args.resolution?.setup,
    start: args.resolution?.start,
    env: args.resolution?.env,
    mounts: mountsWithGitMetadata({ worktree: args.worktree, declared: args.resolution?.mounts ?? [] }),
    atlasHomeSubtrees:
      args.atlasHomeSubtrees ??
      mountedAtlasHomeSubtrees({ worktree: args.worktree, declared: args.resolution?.mounts }),
  }
}
