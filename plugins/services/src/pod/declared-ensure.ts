import { interpolateServiceEnv, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  declaredOrder,
  runningDeclaredOf,
  serviceCwdOf,
  servicesOfEvents,
  type DeclaredServices,
} from '../core'
import { runCommand, stopService } from './daemon'
import { launchTracked } from './launch'
import { allocatePort, type DeclaredPlace } from './place'
import { forwardReferences } from './references'
import { serviceEnvOf } from './service-env'
import type { ServicePodState } from './state'

const SETUP_TAIL_CHARACTERS = 2_000

const ADVICE =
  'Their endings arrive on their own, so do not poll for them; `service` with action `list` shows what is running and its port.'

const tailOf = (text: string): string => text.trimEnd().slice(-SETUP_TAIL_CHARACTERS)

export const setupKeyOf = (args: { root: string; name: string }): string =>
  `${args.root}\u0000${args.name}`

const runSetup = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  key: string
  commands: readonly string[]
  cwd: string
  env: Record<string, string>
  signal?: AbortSignal | undefined
}): Promise<string | undefined> => {
  if (args.state.setupDone.has(args.key)) return undefined
  for (const command of args.commands) {
    const ran = await runCommand({
      ctx: args.ctx,
      command,
      cwd: args.cwd,
      env: args.env,
      signal: args.signal,
    })
    if (!ran.ok) return `setup "${command}" could not run: ${ran.reason}`
    if (ran.value.exitCode !== 0) {
      const tail = tailOf(ran.value.output)
      return `setup "${command}" exited ${ran.value.exitCode ?? 'without an exit code'}${tail === '' ? '' : `\n${tail}`}`
    }
  }
  args.state.setupDone.add(args.key)
  return undefined
}

type Started = {
  name: string
  serviceId: string
  port?: number | undefined
  url?: string | undefined
}

const startedLine = (one: Started): string => {
  const port = one.port === undefined ? '' : ` on port ${one.port}`
  const url = one.url === undefined ? '' : ` at ${one.url}`
  return `${one.name} is running as ${one.serviceId}${port}${url}.`
}

export const ensureDeclared = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  declared: DeclaredServices
  name: string
  place: DeclaredPlace
  restart?: boolean | undefined
  readyTimeoutMs?: number | undefined
  expose?: boolean | undefined
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, place } = args
  const ordered = declaredOrder({ declared: args.declared, name: args.name })
  if (!ordered.ok) return { ok: false, reason: ordered.reason }

  const kept: string[] = []
  const started: Started[] = []
  for (const name of ordered.order) {
    const declaration = args.declared.services.get(name)
    const hash = args.declared.hashes.get(name)
    if (declaration === undefined || hash === undefined) continue

    const running = runningDeclaredOf({
      rows: servicesOfEvents(ctx.events()),
      name,
      root: place.root,
    })
    if (args.restart !== true && running?.declarationHash === hash) {
      kept.push(`${name} was already running as ${running.serviceId}.`)
      continue
    }

    const cwd = serviceCwdOf({ root: place.root, cwd: declaration.cwd })
    const references = await forwardReferences({
      ctx,
      declared: args.declared,
      declaration,
      place,
      signal: args.signal,
    })
    const env = interpolateServiceEnv({ env: declaration.env ?? {}, resolved: references })
    const setup = await runSetup({
      ctx,
      state: args.state,
      key: setupKeyOf({ root: place.root, name }),
      commands: declaration.setup ?? [],
      cwd,
      env: await serviceEnvOf({ ctx, env }),
      signal: args.signal,
    })
    if (setup !== undefined) return { ok: false, reason: `the setup of ${name} failed: ${setup}` }

    if (running !== undefined && args.restart !== true) {
      const stopped = await stopService({ ctx, serviceId: running.serviceId, signal: args.signal })
      if (!stopped.ok) return { ok: false, reason: stopped.reason }
    }

    const port = await allocatePort({
      ctx,
      rows: servicesOfEvents(ctx.events()),
      name,
      root: place.root,
      declared: declaration.port,
      signal: args.signal,
    })
    const launched = await launchTracked({
      ctx,
      state: args.state,
      command: declaration.command,
      description: name,
      cwd,
      name,
      declarationHash: hash,
      root: place.root,
      branch: place.branch,
      env,
      port,
      healthPath: declaration.health,
      readyTimeoutMs: args.readyTimeoutMs,
      expose: args.expose,
      signal: args.signal,
    })
    if (!launched.ok) return { ok: false, reason: launched.reason }
    started.push({
      name,
      serviceId: launched.value.serviceId,
      ...(port === undefined ? {} : { port }),
      ...(launched.value.url === undefined ? {} : { url: launched.value.url }),
    })
  }

  return {
    ok: true,
    output: {
      serviceId: started.at(-1)?.serviceId,
      services: [...args.declared.services.keys()],
      started,
      root: place.root,
    },
    modelText: [...kept, ...started.map(startedLine), ADVICE].join('\n'),
  }
}
