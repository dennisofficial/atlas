import { z } from 'zod'

import {
  EExecutionLocation,
  EKilledBy,
  EShellStatus,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type EventLogPort,
  type IdPort,
  type ThreadId,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { isTeammateType } from '../../agents/types'
import type { AgentRegistryPort } from '../../agents/registry/port'
import type { ExecutionLocationControl } from '../../composition/execution-location-state'
import type { DockerEngine } from '../../execution/docker/engine'
import type { ServiceRegistryPort } from '../../services/service-registry'
import type { ShellRegistryPort } from '../../shells/shell-registry'
import { relocateSession, type RelocatedSession } from '../../store/relocate-session'
import type { ThreadStorePort } from '../../store/thread-store'

const inputSchema = z.strictObject({
  location: z.enum([EExecutionLocation.Host, EExecutionLocation.Docker]),
})

const description = [
  'Move this session between the host machine and its Docker container sandbox, carrying the whole family - a sub-agent calling it moves the session it belongs to, sub-agents included, while a teammate calling it moves only itself and its own sub-agents.',
  'Pass location "docker" so later bash, read and write calls run inside the container - prefer it before starting dev servers, installing dependencies or running test suites you want kept off the host - or "host" to run on this machine directly.',
  'The move kills running background shells and stops services, so restart anything long-lived afterwards, in the new location.',
  'Sub-agents move with the session that calls this; teammates own their execution location independently and never move along with the main session or a sibling teammate.',
  'Asking for the location the session already runs in just answers where it is.',
  'The cloud is never a target: moving to or from it is the operator’s call.',
].join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

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
    },
  ) {
    super()
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const target = input.location
    const { control } = this.deps
    const stores = this.deps.stores()
    const root = await this.familyRoot(threadId, stores.threads)
    const from = control.state.of(root) ?? control.state.current()

    if (from === EExecutionLocation.Cloud) {
      return {
        ok: false,
        reason:
          'this session is running in the cloud, and moving between cloud and local is the operator’s call — ask them to switch rather than relocating it yourself',
      }
    }
    if (control.pinned) {
      return {
        ok: false,
        reason: `this session was pinned to ${from} at launch (--execution-location), so it cannot move itself — ask the operator to switch`,
      }
    }
    if (from === target) {
      return {
        ok: true,
        output: { executionLocation: target },
        modelText: `The session already executes on ${target}.`,
      }
    }

    if (target === EExecutionLocation.Docker) {
      try {
        await this.deps.engine.info()
      } catch (error) {
        return {
          ok: false,
          reason: `the Docker daemon is not answering (${messageOf(error)}), so the session stays on ${from}`,
        }
      }
    }

    const killed = this.deps.shells
      .list({ threadId: root })
      .filter((shell) => shell.status === EShellStatus.Running)
    for (const shell of killed) {
      this.deps.shells.kill({ shellId: shell.shellId, by: EKilledBy.ContainerSwitch, threadId: root })
    }

    control.state.set(target)
    control.state.note({ threadId: root, location: target })

    let moved: RelocatedSession
    try {
      await stores.threads.chooseExecutionLocation({ threadId: root, location: target })
      moved = await relocateSession({
        threadId: root,
        from,
        location: target,
        caller: threadId,
        log: stores.log,
        ids: this.deps.ids,
        services: this.deps.services,
        agents: stores.agents,
      })
    } catch (error) {
      control.state.set(from)
      control.state.note({ threadId: root, location: from })
      await stores.threads
        .chooseExecutionLocation({ threadId: root, location: from })
        .catch(() => undefined)
      return {
        ok: false,
        reason: `the move to ${target} failed (${messageOf(error)}) — the session is back on ${from}`,
      }
    }

    return {
      ok: true,
      output: { executionLocation: { from, to: target } },
      modelText: this.announce({ target, from, killedShells: killed.length, moved }),
    }
  }

  private announce(args: {
    target: EExecutionLocation
    from: EExecutionLocation
    killedShells: number
    moved: RelocatedSession
  }): string {
    const where =
      args.target === EExecutionLocation.Docker
        ? 'inside the Docker container sandbox'
        : 'on the host machine'
    const sentences = [
      `The session now executes ${where} (was ${args.from}); every later bash, read and write runs there.`,
    ]
    if (args.killedShells > 0) {
      sentences.push(
        `The move killed ${args.killedShells} running background ${args.killedShells === 1 ? 'shell' : 'shells'} — restart whatever should keep running, in the new location.`,
      )
    }
    if (args.moved.stoppedServices.length > 0) {
      sentences.push(
        `It stopped ${args.moved.stoppedServices.length} running ${args.moved.stoppedServices.length === 1 ? 'service' : 'services'} (${args.moved.stoppedServices.map((one) => one.description).join(', ')}).`,
      )
    }
    if (args.moved.relocatedAgents.length > 0) {
      sentences.push(
        `${args.moved.relocatedAgents.length} ${args.moved.relocatedAgents.length === 1 ? 'sub-agent' : 'sub-agents'} moved with the session (teammates were not).`,
      )
    }
    return sentences.join(' ')
  }

  private async familyRoot(threadId: ThreadId, threads: ThreadStorePort): Promise<ThreadId> {
    let root = threadId
    for (let depth = 0; depth < 32; depth += 1) {
      const summary = await threads.find({ threadId: root })
      const agent = summary?.agent
      if (agent === undefined) return root
      if (isTeammateType(agent.type)) return root
      root = agent.spawnedBy
    }
    return root
  }
}
