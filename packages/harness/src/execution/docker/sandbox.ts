import { createHash } from 'node:crypto'

import { mountBind, type Mount } from '../image/mounts'
import { dockerfileImageReference, ensureBuiltImage, type DockerfileBuild } from '../image/build'
import { gitConfigEnv } from '../../workspace/git-config-env'
import {
  declaredMountsDrift,
  declaredMountsLabel,
  encodeDeclaredMounts,
  encodeLaunchConfig,
  envDrift,
  launchConfigLabel,
  missingIdentityMounts,
} from './mount-drift'
import { prepareContainerForOperator } from './operator-setup'
import { runSandboxScripts } from './sandbox-scripts'
import type { ContainerSummary, CreateContainerBody, DockerEngine } from './engine'
import type { DockerImages } from './engine-images'

export const DEFAULT_LABEL_PREFIX = 'atlas'

export const DEFAULT_SANDBOX_IMAGE = 'ghcr.io/dennisofficial/atlas-sandbox:latest'

export const DEFAULT_DOCKER_SOCKET = '/var/run/docker.sock'

export const CONTAINER_GNUPG_HOME = '/run/atlas/gnupg'

export type SandboxEngine = Pick<
  DockerEngine,
  | 'createContainer'
  | 'createExec'
  | 'createNetwork'
  | 'info'
  | 'inspectContainer'
  | 'inspectExec'
  | 'listContainers'
  | 'listNetworks'
  | 'removeContainer'
  | 'startContainer'
  | 'startExec'
> & {
  images: Pick<DockerImages, 'buildImage' | 'listImages'>
}

export type SandboxLimits = {
  cpus: number
  memoryBytes: number
}

export type SandboxConfig = {
  image: string
  worktree: string
  session: string
  uid: number
  gid: number
  home: string
  limits: SandboxLimits
  dockerSocket: string
  labelPrefix?: string | undefined
  sshAuthSock?: string | undefined
  sshKnownHostsPath?: string | undefined
  gpgAgentExtraSocket?: string | undefined
  gpgPubringPath?: string | undefined
  gitconfigPath?: string | undefined
  setup?: string | undefined
  start?: string | undefined
  dockerfile?: DockerfileBuild | undefined
  env?: Record<string, string> | undefined
  githubToken?: string | undefined
  mounts?: readonly Mount[] | undefined
  atlasHomeSubtrees?: readonly Mount[] | undefined
}

export type Sandbox = {
  id: string
  name: string
  created: boolean
  warnings: readonly string[]
}

export const worktreeLabel = (prefix: string): string => `${prefix}.worktree`

export const sessionLabel = (prefix: string): string => `${prefix}.session`

export const roleLabel = (prefix: string): string => `${prefix}.role`

export const EXPOSE_PROXY_ROLE = 'expose-proxy'

export const sessionHashFor = (session: string): string =>
  createHash('sha256').update(session).digest('hex').slice(0, 12)

export const sandboxNameFor = (args: { prefix: string; session: string }): string =>
  `${args.prefix}-${sessionHashFor(args.session)}`

export const sandboxNetworkNameFor = (args: { prefix: string; session: string }): string =>
  `${args.prefix}-net-${sessionHashFor(args.session)}`

export function sandboxCreateBody(config: SandboxConfig): CreateContainerBody {
  const prefix = config.labelPrefix ?? DEFAULT_LABEL_PREFIX
  const network = sandboxNetworkNameFor({ prefix, session: config.session })
  const binds: string[] = [
    `${config.worktree}:${config.worktree}`,
    `${config.dockerSocket}:${config.dockerSocket}`,
  ]
  const env: string[] = [
    `HOME=${config.home}`,
    `COMPOSE_PROJECT_NAME=${sandboxNameFor({ prefix, session: config.session })}`,
    'NODE_ENV=development',
  ]

  if (config.sshAuthSock !== undefined) {
    binds.push(`${config.sshAuthSock}:${config.sshAuthSock}`)
    env.push(`SSH_AUTH_SOCK=${config.sshAuthSock}`)
  }
  if (config.sshKnownHostsPath !== undefined) {
    binds.push(`${config.sshKnownHostsPath}:${config.sshKnownHostsPath}:ro`)
  }
  if (config.gitconfigPath !== undefined) {
    binds.push(`${config.gitconfigPath}:${config.gitconfigPath}:ro`)
  }
  for (const subtree of config.atlasHomeSubtrees ?? []) binds.push(mountBind(subtree))
  for (const mount of config.mounts ?? []) binds.push(mountBind(mount))

  env.push(...gitConfigEnv({ worktree: config.worktree, githubToken: config.githubToken }))
  if (config.gpgAgentExtraSocket !== undefined) {
    // gpg derives its agent socket from GNUPGHOME and offers no path override, so the forwarded
    // agent-extra-socket has to land at the standard agent path of whichever home gpg is given.
    // https://gnupg.org/documentation/manuals/gnupg/Agent-Options.html#index-extra_002dsocket
    binds.push(`${config.gpgAgentExtraSocket}:${CONTAINER_GNUPG_HOME}/S.gpg-agent`)
    if (config.gpgPubringPath !== undefined) {
      binds.push(`${config.gpgPubringPath}:${CONTAINER_GNUPG_HOME}/pubring.kbx:ro`)
    }
    env.push(`GNUPGHOME=${CONTAINER_GNUPG_HOME}`)
  }

  // gh authenticates non-interactively from GH_TOKEN — no credential file is mounted, so the
  // sandbox gets the operator's github access without the token touching a disk in there.
  // https://cli.github.com/manual/gh_help_environment
  if (config.githubToken !== undefined) env.push(`GH_TOKEN=${config.githubToken}`)

  const declared = Object.entries(config.env ?? {})
  const computed = env.filter((entry) => !config.env?.[entry.slice(0, entry.indexOf('='))])
  env.length = 0
  env.push(...computed, ...declared.map(([key, value]) => `${key}=${value}`))

  return {
    Image: config.image,
    Cmd: ['sleep', 'infinity'],
    User: `${config.uid}:${config.gid}`,
    WorkingDir: config.worktree,
    Env: env,
    Labels: {
      [worktreeLabel(prefix)]: config.worktree,
      [sessionLabel(prefix)]: config.session,
      [declaredMountsLabel(prefix)]: encodeDeclaredMounts(config.mounts ?? []),
      [launchConfigLabel(prefix)]: encodeLaunchConfig({ config, env, binds, network }),
    },
    HostConfig: {
      Binds: binds,
      ...(config.limits.cpus === 0 ? {} : { NanoCpus: config.limits.cpus * 1e9 }),
      ...(config.limits.memoryBytes === 0 ? {} : { Memory: config.limits.memoryBytes }),
    },
    NetworkingConfig: {
      EndpointsConfig: { [network]: {} },
    },
  }
}

export async function ensureSandboxNetwork(args: {
  engine: SandboxEngine
  prefix: string
  session: string
  worktree: string
}): Promise<string> {
  const name = sandboxNetworkNameFor({ prefix: args.prefix, session: args.session })
  const existing = await args.engine.listNetworks({
    labels: { [sessionLabel(args.prefix)]: args.session },
  })
  if (existing.length > 0) return name

  await args.engine.createNetwork({
    name,
    labels: {
      [worktreeLabel(args.prefix)]: args.worktree,
      [sessionLabel(args.prefix)]: args.session,
    },
  })
  return name
}

export async function findSandbox(args: {
  engine: SandboxEngine
  prefix: string
  session: string
}): Promise<ContainerSummary | undefined> {
  const matches = await args.engine.listContainers({
    labels: { [sessionLabel(args.prefix)]: args.session },
    all: true,
  })
  return matches.find((one) => one.labels[roleLabel(args.prefix)] !== EXPOSE_PROXY_ROLE)
}

export async function oversubscriptionWarnings(args: {
  engine: SandboxEngine
  prefix: string
  adding: SandboxLimits
}): Promise<string[]> {
  const [info, running] = await Promise.all([
    args.engine.info(),
    args.engine.listContainers({ labels: { [worktreeLabel(args.prefix)]: undefined } }),
  ])
  const details = await Promise.all(
    running.map((container) => args.engine.inspectContainer({ id: container.id })),
  )

  const memoryBytes =
    details.reduce((total, one) => total + one.hostConfig.memoryBytes, 0) + args.adding.memoryBytes
  const nanoCpus =
    details.reduce((total, one) => total + one.hostConfig.nanoCpus, 0) + args.adding.cpus * 1e9

  const warnings: string[] = []
  if (args.adding.memoryBytes === 0) {
    warnings.push(
      'this sandbox has no memory limit — a runaway process in it can take the whole daemon down, other sandboxes included',
    )
  }
  if (memoryBytes > info.memoryBytes) {
    warnings.push(
      `the running sandboxes plus this one are limited to ${Math.round(memoryBytes / 1024 ** 3)} GB of memory against the daemon's ${Math.round(info.memoryBytes / 1024 ** 3)} GB — the OOM killer will arbitrate, not the limit`,
    )
  }
  if (nanoCpus > info.cpus * 1e9) {
    warnings.push(
      `the running sandboxes plus this one are limited to ${Math.round(nanoCpus / 1e9)} cpus against the daemon's ${info.cpus} — they will throttle each other, not queue`,
    )
  }
  return warnings
}

export async function ensureSandbox(args: {
  engine: SandboxEngine
  config: SandboxConfig
}): Promise<Sandbox> {
  const prefix = args.config.labelPrefix ?? DEFAULT_LABEL_PREFIX
  const name = sandboxNameFor({ prefix, session: args.config.session })

  const recreated: string[] = []

  const existing = await findSandbox({ engine: args.engine, prefix, session: args.config.session })
  if (existing !== undefined) {
    const details = await args.engine.inspectContainer({ id: existing.id })
    const wanted =
      args.config.dockerfile === undefined
        ? args.config.image
        : await dockerfileImageReference({ dockerfile: args.config.dockerfile })
    const drifted = declaredMountsDrift({ config: args.config, details, prefix })
    const imageChanged = details.config.image !== wanted
    const envChanged = envDrift({ declared: args.config.env ?? {}, actual: details.config.env })
    const launchChanged =
      details.config.labels[launchConfigLabel(prefix)] !==
      sandboxCreateBody({ ...args.config, image: wanted }).Labels?.[launchConfigLabel(prefix)]

    if (drifted || imageChanged || envChanged || launchChanged) {
      await args.engine.removeContainer({ id: existing.id })
      const why = drifted
        ? 'the declared mounts changed since it was created'
        : imageChanged
          ? `the image changed to ${wanted} since it was created`
          : envChanged
            ? 'the declared env changed since it was created'
            : 'its launch config changed since it was created'
      recreated.push(
        details.state.running
          ? `recreated ${name}: ${why} — it was running, so its shells were killed; anything long-lived in there needs a restart`
          : `recreated ${name}: ${why}, and it was stopped, so nothing live was lost`,
      )
    } else {
      if (!details.state.running) await args.engine.startContainer({ id: existing.id })
      await ensureSandboxNetwork({
        engine: args.engine,
        prefix,
        session: args.config.session,
        worktree: args.config.worktree,
      })
      await prepareContainerForOperator({
        engine: args.engine,
        containerId: existing.id,
        config: args.config,
      })
      const warnings = await runSandboxScripts({
        engine: args.engine,
        containerId: existing.id,
        name,
        config: args.config,
        created: false,
      })
      return {
        id: existing.id,
        name,
        created: false,
        warnings: [
          ...missingIdentityMounts({ config: args.config, actual: details.mounts }),
          ...warnings,
        ],
      }
    }
  }

  const warnings = await oversubscriptionWarnings({
    engine: args.engine,
    prefix,
    adding: args.config.limits,
  })
  const image =
    args.config.dockerfile === undefined
      ? args.config.image
      : await ensureBuiltImage({ builder: args.engine.images, dockerfile: args.config.dockerfile })
  await ensureSandboxNetwork({
    engine: args.engine,
    prefix,
    session: args.config.session,
    worktree: args.config.worktree,
  })
  const created = await args.engine.createContainer({
    name,
    body: sandboxCreateBody({ ...args.config, image }),
  })
  await args.engine.startContainer({ id: created.id })
  await prepareContainerForOperator({
    engine: args.engine,
    containerId: created.id,
    config: args.config,
  })
  const scriptWarnings = await runSandboxScripts({
    engine: args.engine,
    containerId: created.id,
    name,
    config: args.config,
    created: true,
  })

  return {
    id: created.id,
    name,
    created: true,
    warnings: [...recreated, ...warnings, ...created.warnings, ...scriptWarnings],
  }
}
