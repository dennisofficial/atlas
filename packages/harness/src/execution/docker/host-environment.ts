import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isUnderPath } from '@dltech/atlas-core'

import {
  DEFAULT_DOCKER_SOCKET,
  DEFAULT_SANDBOX_IMAGE,
  type SandboxConfig,
  type SandboxLimits,
} from './sandbox'
import { EMountMode, type Mount } from '../image/mounts'
import { atlasDirectory } from '../../store/paths'
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
    sshAuthSock: sshAuthSock !== undefined && existsSync(sshAuthSock) ? sshAuthSock : undefined,
    sshKnownHostsPath: existingFilePath(sshKnownHostsPath),
    gpgAgentExtraSocket: gpgAgentSocket,
    gpgPubringPath: gpgAgentSocket !== undefined ? existingFilePath(gpgPubringPath) : undefined,
    gitconfigPath: existsSync(gitconfigPath) ? gitconfigPath : undefined,
    githubToken: githubToken(env),
  }
}

const SESSIONS_SUBTREE = 'sessions'

// The atlas-home root itself must never become reachable by widening this list. Mounting only
// these named subtrees is what keeps auth.json and the vault key out of the container — credentials
// never enter the sandbox. The subtrees mount read-write: a container session is the same agent
// with the same capabilities, so it saves memories and installs skills exactly as it would on the
// host. sessions mounts so a detached shell supervisor in the container works in the same session
// folder the host Atlas reattaches from.
export const ATLAS_HOME_MOUNTED_SUBTREES = [
  'memory',
  'skills',
  'agents',
  'projects',
  'sessions',
  'services',
  'bin',
] as const

export function mountedAtlasHomeSubtrees(args: {
  worktree: string
  atlasHome?: string | undefined
}): readonly Mount[] {
  const atlasHome = args.atlasHome ?? atlasDirectory()
  mkdirSync(join(atlasHome, SESSIONS_SUBTREE), { recursive: true })

  return ATLAS_HOME_MOUNTED_SUBTREES.map((name) => ({
    path: join(atlasHome, name),
    mode: EMountMode.ReadWrite,
  })).filter(
    (subtree) =>
      existsSync(subtree.path) && !isUnderPath({ directory: args.worktree, path: subtree.path }),
  )
}

export function sandboxConfigFromHost(args: {
  worktree: string
  session: string
  limits: SandboxLimits
  image?: string | undefined
  labelPrefix?: string | undefined
  atlasHomeSubtrees?: readonly Mount[] | undefined
}): SandboxConfig {
  const host = hostSandboxEnvironment()

  return {
    image: args.image ?? DEFAULT_SANDBOX_IMAGE,
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
    mounts: mountsWithGitMetadata({ worktree: args.worktree }),
    atlasHomeSubtrees:
      args.atlasHomeSubtrees ?? mountedAtlasHomeSubtrees({ worktree: args.worktree }),
  }
}
