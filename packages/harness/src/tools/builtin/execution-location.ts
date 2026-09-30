import { z } from 'zod'

import {
  EExecutionLocation,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type EventLogPort,
  type IdPort,
  type LogPort,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../agents/registry/port'
import type { ExecutionLocationControl } from '../../composition/execution-location-state'
import type { DockerEngine } from '../../execution/docker/engine'
import { moveLocalPlacement } from '../../execution/local-placement-move'
import type { ServiceRegistryPort } from '../../services/service-registry'
import type { ShellRegistryPort } from '../../shells/shell-registry'
import type { RelocatedSession } from '../../store/relocate-session'
import type { ThreadStorePort } from '../../store/thread-store'

const inputSchema = z.strictObject({
  location: z.enum([EExecutionLocation.Host, EExecutionLocation.Docker]),
})

const description = [
  'Move this session between the host machine and its Docker container sandbox. Only the session that owns its tools can move them: the main session or a teammate moves itself and its own sub-agents; a sub-agent is refused, because it follows the agent that owns it.',
  'Pass location "docker" so later bash, read and write calls run inside the container - prefer it before starting dev servers, installing dependencies or running test suites you want kept off the host - or "host" to run on this machine directly.',
  'The move kills running background shells and stops services, waiting for the endings it caused so they are already on their way to you when the call returns - restart anything long-lived afterwards, in the new location.',
  'Asking for the location the session already runs in just answers where it is.',
  'The cloud is never a target: moving to or from it is the operator’s call.',
].join(' ')

export class ExecutionLocationTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'execution_location'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(
    private readonly deps: {
      control: ExecutionLocationControl
      engine: DockerEngine
      ids: IdPort
      services: ServiceRegistryPort
      shells: ShellRegistryPort
      /** The store-backed ports, resolved at call time: building the registry must not open a database. */
      stores: () => { threads: ThreadStorePort; log: EventLogPort; agents: AgentRegistryPort }
      logPort?: LogPort | undefined
    },
  ) {
    super()
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const target = input.location
    const move = await moveLocalPlacement({
      control: this.deps.control,
      threadId,
      target,
      engine: this.deps.engine,
      ids: this.deps.ids,
      shells: this.deps.shells,
      services: this.deps.services,
      stores: this.deps.stores,
      caller: threadId,
      ...(this.deps.logPort === undefined ? {} : { logPort: this.deps.logPort }),
    })

    if (!move.ok) return { ok: false, reason: move.reason }
    if (move.from === move.to) {
      return {
        ok: true,
        output: { executionLocation: target },
        modelText: `The session already executes on ${target}.`,
      }
    }
    return {
      ok: true,
      output: { executionLocation: { from: move.from, to: move.to } },
      modelText: this.announce({ move }),
    }
  }

  private announce(args: {
    move: {
      to: EExecutionLocation
      from: EExecutionLocation
      killedShells: number
      moved: RelocatedSession
      stillDying: number
    }
  }): string {
    const { move } = args
    const where =
      move.to === EExecutionLocation.Docker
        ? 'inside the Docker container sandbox'
        : 'on the host machine'
    const sentences = [
      `The session now executes ${where} (was ${move.from}); every later bash, read and write runs there.`,
    ]
    if (move.killedShells > 0) {
      sentences.push(
        `The move killed ${move.killedShells} running background ${move.killedShells === 1 ? 'shell' : 'shells'} — restart whatever should keep running, in the new location.`,
      )
    }
    if (move.moved.stoppedServices.length > 0) {
      sentences.push(
        `It stopped ${move.moved.stoppedServices.length} running ${move.moved.stoppedServices.length === 1 ? 'service' : 'services'} (${move.moved.stoppedServices.map((one) => one.description).join(', ')}).`,
      )
    }
    if (move.moved.relocatedAgents.length > 0) {
      sentences.push(
        `${move.moved.relocatedAgents.length} ${move.moved.relocatedAgents.length === 1 ? 'sub-agent' : 'sub-agents'} moved with the session (teammates were not).`,
      )
    }
    if (move.stillDying > 0) {
      sentences.push(
        `${move.stillDying} of the stopped processes had not exited within the settle bound; their endings will arrive when they do, the same as any other ending.`,
      )
    }
    return sentences.join(' ')
  }
}
