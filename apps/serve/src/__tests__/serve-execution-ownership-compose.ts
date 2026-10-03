import { join } from 'node:path'

import {
  defaultPipeline,
  EMPTY_PROMPT,
  EAgentStatus,
  EServiceStatus,
  EShellStatus,
} from '@dltech/atlas-core'

import { AgentSupervisor, childRunnerSource } from '@dltech/atlas-harness'
import { createDeltaChannel } from '@dltech/atlas-harness'
import { HookChain } from '@dltech/atlas-harness'
import { MessageIntake, noticeSources, operatorSource } from '@dltech/atlas-harness'
import { PublishingTurnRunner } from '@dltech/atlas-harness'
import { createPendingQueues } from '@dltech/atlas-harness'
import { BunServiceRegistry, BunShellRegistry } from '@dltech/atlas-harness'
import { DurableShellLauncher, ShellStorage, prepareSupervisorLauncher } from '@dltech/atlas-harness'
import { LocalProcessPort } from '@dltech/atlas-harness'
import { BashTool } from '@dltech/atlas-harness'
import { HookedToolDispatcher, InMemoryToolRegistry } from '@dltech/atlas-harness'
import {
  JsonlEventLog,
  JsonlTurnLedger,
  RandomIds,
  registryFor,
  SystemClock,
} from '@dltech/atlas-harness'

import { AgentSpawnTool } from '../../../../packages/harness/src/tools/builtin/agent-spawn'
import { ServiceStartTool } from '../../../../packages/harness/src/tools/builtin/service-start'
import { SessionEnvironmentProcessPort } from '../../../../packages/harness/src/execution/session-environment'
import { JsonlThreadStore } from '../../../../packages/harness/src/store/sessions/thread-store'

import type { ServeApp } from '../index'
import { OWNERSHIP_AGENT_TYPE } from './serve-execution-ownership-fixture'
import { scriptedPort, type OwnershipStep } from './serve-execution-ownership-model'

export type OwnershipRegistries = {
  shells: BunShellRegistry
  agents: AgentSupervisor
  services: BunServiceRegistry
}

export type ComposedOwnership = {
  serveApp: ServeApp
  registries: OwnershipRegistries
}

export async function composeOwnershipApp(args: {
  home: string
  cwd: string
  main: readonly OwnershipStep[]
  child: readonly OwnershipStep[]
  childGate?: Promise<void> | undefined
}): Promise<ComposedOwnership> {
  const main = scriptedPort({ steps: args.main, modelId: 'main' })
  const childModel = scriptedPort({
    steps: args.child,
    modelId: 'child',
    beforeStep:
      args.childGate === undefined
        ? undefined
        : async (index) => {
            if (index === 0) await args.childGate
          },
  })

  const clock = new SystemClock()
  const ids = new RandomIds()
  const registry = registryFor({ home: args.home })
  const log = new JsonlEventLog(args.home, registry, clock, ids)
  const threads = new JsonlThreadStore(args.home, registry, clock, ids, log)
  const ledger = new JsonlTurnLedger({ home: args.home, registry })

  const hooks = new HookChain({})
  const channel = createDeltaChannel()
  const processes = new LocalProcessPort()

  const shellProcesses = new SessionEnvironmentProcessPort({ inner: processes, sessions: registry })
  const shells = new BunShellRegistry({
    root: args.cwd,
    clock,
    hooks: () => hooks,
    launcher: new DurableShellLauncher({
      storage: new ShellStorage({ sessions: registry }),
      sessions: registry,
      processes: shellProcesses,
      supervisor: () => prepareSupervisorLauncher({ home: args.home }),
      now: () => clock.now(),
    }),
    log,
    ids,
  })
  const services = new BunServiceRegistry({
    root: args.cwd,
    clock,
    logsDirectory: join(args.home, 'service-logs'),
    processes,
  })

  const pending = createPendingQueues()
  const intakeHolder: { current?: MessageIntake } = {}
  const agentsHolder: { current?: AgentSupervisor } = {}

  const tools = new InMemoryToolRegistry([
    new BashTool(shells),
    new AgentSpawnTool(() => {
      const agents = agentsHolder.current
      if (agents === undefined) throw new Error('spawn before the supervisor existed')
      return agents
    }, [OWNERSHIP_AGENT_TYPE]),
    new ServiceStartTool(services),
  ])

  const assembly = defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: args.cwd })

  const runner = new PublishingTurnRunner({
    channel,
    deps: {
      log,
      model: main,
      ids,
      assembly,
      tools: () => tools.declarations(),
      dispatch: new HookedToolDispatcher({ registry: tools, hooks }),
      drainPending: async (drained) => {
        const intake = intakeHolder.current
        if (intake === undefined) return { drafts: [], wakesTurn: false }
        return intake.prepare(drained)
      },
      spend: { ledger, clock },
      launchDirectory: args.cwd,
    },
  })

  const runners = childRunnerSource({
    deps: () => ({
      turn: {
        log,
        model: childModel,
        ids,
        assembly,
        launchDirectory: args.cwd,
      },
      tools,
      hooks,
      channel,
      assemblyFor: () => assembly,
      drainNotices: () => Promise.resolve({ drafts: [], wakesTurn: false }),
      modelFor: () => childModel,
    }),
  })

  const agents = new AgentSupervisor({
    log,
    threads,
    ids,
    clock,
    agentTypes: [OWNERSHIP_AGENT_TYPE],
    runners,
    launchDirectory: args.cwd,
    intake: {
      changed: () => intakeHolder.current?.changed(),
      prepare: async (request) => {
        const intake = intakeHolder.current
        if (intake === undefined) {
          return { drafts: [], wakesTurn: false, acknowledge: () => undefined }
        }
        return intake.prepare(request)
      },
    },
  })
  agentsHolder.current = agents

  const intake = new MessageIntake({
    sources: [...noticeSources({ shells, agents, services }), operatorSource(pending)],
    submit: ({ threadId, ...said }) => pending.forThread({ threadId }).enqueue(said),
  })
  intakeHolder.current = intake

  const close = async (): Promise<void> => {
    intake.suspend()
    await agents.closeAll()
    await shells.closeAll()
    await services.closeAll()
    await Promise.all(
      [...new Set(intake.threadsWithPendingInput())].map((threadId) =>
        intake
          .commit({
            threadId,
            append: async (drafts) => {
              await log.append({ threadId, runId: ids.nextRunId(), drafts })
            },
          })
          .catch(() => undefined),
      ),
    )
    intake.dispose()
  }

  return {
    serveApp: {
      channel,
      runner,
      log,
      threads,
      ids,
      files: { list: async () => [], forget: () => undefined },
      workspace: { workspace: args.cwd, repo: null },
      pending,
      intake,
      adoptChildren: async () => [],
      whenChildrenSettled: ({ threadId }) => agents.whenChildrenSettled({ threadId }),
      runningChildren: () =>
        agents.listEverywhere().filter((one) => one.status === EAgentStatus.Running).length,
      pendingInput: () => pending.waitingCount() > 0,
      runningShells: () =>
        shells.listEverywhere().filter((one) => one.status === EShellStatus.Running).length,
      runningServices: () =>
        services.list().filter((one) => one.status === EServiceStatus.Running).length,
      close,
    },
    registries: { shells, agents, services },
  }
}
