import { EServiceStatus, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { servicesOfEvents } from '../core'
import { declaredOrder, type DeclaredServices } from '../core/declared'
import { runCommand, stopService } from './daemon'
import { launchTracked } from './launch'
import { serviceEnvOf } from './service-env'
import type { ServicePodState } from './state'

const SETUP_TAIL_CHARACTERS = 2_000

const ADVICE =
  'Their endings arrive on their own, so do not poll for them; service_list shows what is running and its port.'

const tailOf = (text: string): string => text.trimEnd().slice(-SETUP_TAIL_CHARACTERS)

const runSetup = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  name: string
  commands: readonly string[]
  cwd: string
  env?: Record<string, string> | undefined
  signal?: AbortSignal | undefined
}): Promise<string | undefined> => {
  if (args.state.setupDone.has(args.name)) return undefined
  const env = await serviceEnvOf({ ctx: args.ctx, env: args.env })
  for (const command of args.commands) {
    const ran = await runCommand({
      ctx: args.ctx,
      command,
      cwd: args.cwd,
      env,
      signal: args.signal,
    })
    if (!ran.ok) return `setup "${command}" could not run: ${ran.reason}`
    if (ran.value.exitCode !== 0) {
      const tail = tailOf(ran.value.output)
      return `setup "${command}" exited ${ran.value.exitCode ?? 'without an exit code'}${tail === '' ? '' : `\n${tail}`}`
    }
  }
  args.state.setupDone.add(args.name)
  return undefined
}

const runningNamed = (args: { ctx: PluginPodContext; name: string }) =>
  servicesOfEvents(args.ctx.events()).find(
    (row) => row.name === args.name && row.status === EServiceStatus.Running,
  )

export const ensureDeclared = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  declared: DeclaredServices
  name: string
  projectDirectory: string
  restart?: boolean | undefined
  readyTimeoutMs?: number | undefined
  expose?: boolean | undefined
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const ordered = declaredOrder({ declared: args.declared, name: args.name })
  if (!ordered.ok) return { ok: false, reason: ordered.reason }

  const kept: string[] = []
  const started: { name: string; serviceId: string; url?: string | undefined }[] = []
  for (const name of ordered.order) {
    const declaration = args.declared.services.get(name)
    const hash = args.declared.hashes.get(name)
    if (declaration === undefined || hash === undefined) continue

    const running = runningNamed({ ctx: args.ctx, name })
    if (args.restart !== true && running?.declarationHash === hash) {
      kept.push(`${name} was already running as ${running.serviceId}.`)
      continue
    }

    const cwd = declaration.cwd ?? args.projectDirectory
    const setup = await runSetup({
      ctx: args.ctx,
      state: args.state,
      name,
      commands: declaration.setup ?? [],
      cwd,
      env: declaration.env,
      signal: args.signal,
    })
    if (setup !== undefined) return { ok: false, reason: `the setup of ${name} failed: ${setup}` }

    if (running !== undefined && args.restart !== true) {
      const stopped = await stopService({
        ctx: args.ctx,
        serviceId: running.serviceId,
        signal: args.signal,
      })
      if (!stopped.ok) return { ok: false, reason: stopped.reason }
    }

    const launched = await launchTracked({
      ctx: args.ctx,
      state: args.state,
      command: declaration.command,
      description: name,
      cwd,
      name,
      declarationHash: hash,
      env: declaration.env,
      port: declaration.port,
      healthPath: declaration.health,
      readyTimeoutMs: args.readyTimeoutMs,
      expose: args.expose,
      signal: args.signal,
    })
    if (!launched.ok) return { ok: false, reason: launched.reason }
    started.push({
      name,
      serviceId: launched.value.serviceId,
      ...(launched.value.url === undefined ? {} : { url: launched.value.url }),
    })
  }

  const lines = [
    ...kept,
    ...started.map((one) =>
      one.url === undefined
        ? `${one.name} is running as ${one.serviceId}.`
        : `${one.name} is running as ${one.serviceId} at ${one.url}.`,
    ),
    ADVICE,
  ]
  return {
    ok: true,
    output: {
      serviceId: started.at(-1)?.serviceId,
      services: [...args.declared.services.keys()],
      started,
    },
    modelText: lines.join('\n'),
  }
}
