import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { dockerfileImageReference } from '../image/build'
import { atlasDirectory } from '../../store/paths'
import type { DockerEngine } from './engine'
import { proxyScriptSource } from './expose-proxy-script'
import { hostPortFor } from './ports'
import {
  DEFAULT_LABEL_PREFIX,
  EXPOSE_PROXY_ROLE,
  roleLabel,
  sandboxNetworkNameFor,
  sessionHashFor,
  sessionLabel,
  worktreeLabel,
  type SandboxConfig,
} from './sandbox'

export const PROXY_CONTAINER_PORT = 7676

const CONTAINER_PROXY_DIRECTORY = '/opt/atlas-expose'

export type ProxyEngine = Pick<
  DockerEngine,
  'createContainer' | 'inspectContainer' | 'listContainers' | 'startContainer'
>

export const proxyNameFor = (args: { prefix: string; session: string }): string =>
  `${args.prefix}-proxy-${sessionHashFor(args.session)}`

const writeProxyScript = async (args: { hostPort: number }): Promise<string> => {
  const directory = join(atlasDirectory(), 'expose-proxy')
  await mkdir(directory, { recursive: true })
  const script = join(directory, 'proxy.mjs')
  await writeFile(script, proxyScriptSource({ hostPort: args.hostPort, containerPort: PROXY_CONTAINER_PORT }))
  return directory
}

export async function ensureSandboxProxy(args: {
  engine: ProxyEngine
  config: SandboxConfig
  sandboxName: string
}): Promise<{ hostPort: number }> {
  const prefix = args.config.labelPrefix ?? DEFAULT_LABEL_PREFIX
  const { session } = args.config

  const existing = (
    await args.engine.listContainers({
      labels: { [sessionLabel(prefix)]: session, [roleLabel(prefix)]: EXPOSE_PROXY_ROLE },
      all: true,
    })
  )[0]

  if (existing !== undefined) {
    const details = await args.engine.inspectContainer({ id: existing.id })
    if (!details.state.running) await args.engine.startContainer({ id: existing.id })
    const bound = details.ports.find((one) => one.containerPort === PROXY_CONTAINER_PORT)
    if (bound === undefined) {
      throw new Error(`expose proxy ${existing.name} lost its published port; remove the container so it is recreated`)
    }
    return { hostPort: bound.hostPort }
  }

  const hostPort = hostPortFor({ session, containerPort: PROXY_CONTAINER_PORT })
  const scriptDirectory = await writeProxyScript({ hostPort })

  const image =
    args.config.dockerfile === undefined
      ? args.config.image
      : await dockerfileImageReference({ dockerfile: args.config.dockerfile })

  const created = await args.engine.createContainer({
    name: proxyNameFor({ prefix, session }),
    body: {
      Image: image,
      Cmd: ['node', `${CONTAINER_PROXY_DIRECTORY}/proxy.mjs`],
      Env: [`ATLAS_PROXY_TARGET=${args.sandboxName}`],
      Labels: {
        [worktreeLabel(prefix)]: args.config.worktree,
        [sessionLabel(prefix)]: session,
        [roleLabel(prefix)]: EXPOSE_PROXY_ROLE,
      },
      ExposedPorts: { [`${PROXY_CONTAINER_PORT}/tcp`]: {} },
      HostConfig: {
        Binds: [`${scriptDirectory}:${CONTAINER_PROXY_DIRECTORY}:ro`],
        PortBindings: {
          [`${PROXY_CONTAINER_PORT}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(hostPort) }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
      NetworkingConfig: {
        EndpointsConfig: { [sandboxNetworkNameFor({ prefix, session })]: {} },
      },
    },
  })
  await args.engine.startContainer({ id: created.id })

  return { hostPort }
}
