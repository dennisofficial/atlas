import {
  EAgentStatus,
  EventLogPort,
  EServiceStatus,
  EShellStatus,
  ProcessPort,
} from '@dltech/atlas-core'

import { EFFORT_LADDER, parseRef } from '@dltech/atlas-core'

import { SelectableModelToken } from '@dltech/atlas-harness'
import { atlasDirectory, composeHarness, inProcessPortBindings } from '@dltech/atlas-harness'
import { loadSettings } from '@dltech/atlas-harness'
import { skillExpander } from '@dltech/atlas-harness'
import { mcpStatusWireOf } from './mcp-status'
import {
  registeredPortToken,
  GithubUiBridgePort,
  SubscriptionRegistryPort,
} from '@dltech/atlas-harness'
import {
  ServeSessionToken,
  SessionRegistryToken,
  SessionEnvironmentProcessPort,
} from '@dltech/atlas-harness'
import { ServiceRecovery, resumeDeclaredServices } from '@dltech/atlas-harness'
import { liveServicesOf } from '@dltech/atlas-harness'
import {
  RotationPort,
  ThreadStorePort,
  threadMentionFiles,
  threadPanels,
} from '@dltech/atlas-harness'

import { activateTransferredChildren, adoptTransferredChildren } from '@dltech/atlas-harness'
import type { ServeApp, ServeCompose, ServeModelBridge, ServePrStates } from './serve-app'
import { ServeProcessPort } from './serve-process'
import { serveFamilyOf } from './serve-family'
import { stopWorkspaceProcessesFor, workspaceHooksFor } from './workspace-hooks'
import { exposerFor } from './serve-port-exposer'

export const SERVE_COMMAND = 'serve'

type ServeStores = {
  log: EventLogPort
  threads: ThreadStorePort
  modelBridge: ServeModelBridge
  rotation?: RotationPort | undefined
  prStates?: ServePrStates | undefined
  subscriptions: SubscriptionRegistryPort
}

export const composeServeApp: ServeCompose = async (args): Promise<ServeApp> => {
  const app = await composeHarness<ServeStores>({
    repoIdentity: args.identity ?? null,
    userSkillHome: atlasDirectory(),
    userLayerHome: atlasDirectory(),
    bindPorts: ({ container }) => {
      container.register(ServeSessionToken, {
        useValue: { url: args.controlPlaneUrl, token: args.token, email: null },
      })
    },
    launch: {
      cwd: args.cwd,
      command: SERVE_COMMAND,
      model: args.model,
      executionLocation: 'cloud',
      threadId: args.threadId,
    },
    env: args.env,
    settings: loadSettings({ env: args.env, cwd: args.cwd, cloudScoped: true }),
    clientVersion: args.clientVersion,
    ports: inProcessPortBindings,
    surface: {
      notice: args.notice,
      bind: ({ container }) => {
        const log = container.resolve(registeredPortToken(EventLogPort))
        const threads = container.resolve(registeredPortToken(ThreadStorePort))
        const model = container.resolve(SelectableModelToken)
        const prStates = container.isRegistered(registeredPortToken(GithubUiBridgePort), true)
          ? {
              snapshot: () =>
                container.resolve(registeredPortToken(GithubUiBridgePort)).service.states(),
              subscribe: (listener: () => void) =>
                container
                  .resolve(registeredPortToken(GithubUiBridgePort))
                  .service.subscribe(listener),
            }
          : undefined
        const modelBridge: ServeModelBridge = {
          effort: () => model.choice().effort,
          identity: () => model.choice().ref,
          select: (next) => {
            const ref = parseRef(next.ref)
            if (ref === undefined) return
            const effort =
              EFFORT_LADDER.find((rung) => rung === next.effort) ?? model.choice().effort
            model.select({ ref, effort })
          },
        }

        container.register(registeredPortToken(ProcessPort), {
          useValue: new SessionEnvironmentProcessPort({
            sessions: container.resolve(SessionRegistryToken),
            inner: new ServeProcessPort(exposerFor(args)),
          }),
        })

        const rotation = container.isRegistered(registeredPortToken(RotationPort), true)
          ? container.resolve(registeredPortToken(RotationPort))
          : undefined
        return {
          log,
          threads,
          modelBridge,
          rotation,
          subscriptions: container.resolve(registeredPortToken(SubscriptionRegistryPort)),
          ...(prStates === undefined ? {} : { prStates }),
        }
      },
    },
  })

  const serviceRecovery = new ServiceRecovery({
    log: app.surface.log,
    ids: app.ids,
    live: () => liveServicesOf(app.services.list()),
    registry: app.services,
  })

  const workspaceHooks = workspaceHooksFor({
    threadId: args.threadId,
    shells: app.shells,
    services: app.services,
    log: app.surface.log,
    threads: app.surface.threads,
    ids: app.ids,
  })

  const panels = threadPanels({
    threadId: args.threadId,
    log: app.surface.log,
    threads: app.surface.threads,
    launchDirectory: args.cwd,
    files: app.files,
  })

  const family = serveFamilyOf({
    agents: app.agents,
    threads: app.surface.threads,
    intake: app.intake,
  })

  return {
    channel: app.channel,
    activity: app.activity,
    runner: app.runner,
    turnPolicy: app.turnPolicy,
    log: app.surface.log,
    threads: app.surface.threads,
    modelBridge: app.surface.modelBridge,
    ledger: app.ledger,
    settings: app.settings,
    ids: app.ids,
    files: panels.files,
    mentionFiles: (id) =>
      threadMentionFiles({
        threadId: id,
        log: app.surface.log,
        threads: app.surface.threads,
        launchDirectory: args.cwd,
      }),
    workspace: app.workspace,
    toolEffect: (name) => app.tools.find(name)?.effect,
    pending: app.pending,
    changes: panels.changes,
    terminal: app.terminal,
    ...(app.intake === undefined ? {} : { intake: app.intake }),
    adoptChildren: async ({ threadId, resumeChildren }) => {
      await adoptTransferredChildren({ agents: app.agents, threadId })
      return activateTransferredChildren({
        agents: app.agents,
        log: app.surface.log,
        threadId,
        resumeChildren,
      })
    },
    recordLostShells: ({ threadId }) => app.shells.reconcile({ threadId }),
    recordLostServices: ({ threadId }) => serviceRecovery.recordLost({ threadId }),
    resumeDeclaredServices: ({ threadId }) =>
      resumeDeclaredServices({ services: app.services, log: app.surface.log, threadId }),
    recordLostAgents: ({ threadId }) => app.agents.recordLostAgents({ threadId }),
    whenChildrenSettled: ({ threadId }) => app.agents.whenChildrenSettled({ threadId }),
    family,
    runningChildren: () =>
      app.agents.listEverywhere().filter((child) => child.status === EAgentStatus.Running).length,
    settlingWork: () =>
      (app.agents.settling?.() ?? false) ||
      (app.shells.settling?.() ?? false) ||
      (app.services.settling?.() ?? false),
    pendingInput: () =>
      app.pending.waitingCount() > 0 || (app.intake?.threadsWithPendingInput().length ?? 0) > 0,
    runningShells: () =>
      app.shells.listEverywhere().filter((shell) => shell.status === EShellStatus.Running).length,
    runningServices: () =>
      app.services.list().filter((service) => service.status === EServiceStatus.Running).length,
    executionLocation: app.executionLocation,
    endProcesses: ({ killedBy }) =>
      stopWorkspaceProcessesFor({
        killedBy,
        root: args.threadId,
        shells: app.shells,
        services: app.services,
        log: app.surface.log,
        threads: app.surface.threads,
        ids: app.ids,
      })(),
    ...workspaceHooks,
    ...(app.surface.prStates === undefined ? {} : { prStates: app.surface.prStates }),
    subscriptions: {
      registry: app.surface.subscriptions,
      projectDirectory: app.workspace.workspace,
    },
    titling: app.titling,
    expandContext: skillExpander({ skillRegistry: app.skillRegistry }),
    commands: {
      skills: async ({ reload }) => {
        const skills = reload ? await app.skillRegistry.reload() : app.skillRegistry.all()
        return skills
          .filter((skill) => skill.userInvocable)
          .map(({ spec }) => ({
            name: spec.name,
            summary: spec.summary,
            ...(spec.argumentHint === undefined ? {} : { argumentHint: spec.argumentHint }),
            ...(spec.aliases === undefined ? {} : { aliases: [...spec.aliases] }),
          }))
      },
    },
    mcp: {
      refresh: () => app.mcpRefresh(),
      list: async ({ refresh }) => {
        if (refresh) await app.mcpRefresh()
        return app.mcp().map(mcpStatusWireOf)
      },
    },
    roster: {
      snapshot: () => ({
        shells: [...app.shells.listEverywhere()],
        agents: [...app.agents.listEverywhere()],
        services: [...app.services.list()],
      }),
      subscribe: (listener) => {
        const offs = [
          app.shells.subscribe(listener),
          app.agents.onChange(listener),
          app.services.subscribe(listener),
        ]
        return () => {
          for (const off of offs) off()
        }
      },
    },
    wakeNotices: {
      pendingShells: ({ threadId }) => app.shells.pendingNotices({ threadId }).length,
      pendingAgents: ({ threadId }) => app.agents.pendingNotices({ threadId }).length,
      pendingServices: ({ threadId }) => app.services.pendingNotices({ threadId }).length,
      subscribe: (listener) => {
        const offs = [
          app.shells.onNotice(listener),
          app.agents.onNotice(listener),
          app.services.onNotice(listener),
        ]
        return () => {
          for (const off of offs) off()
        }
      },
    },
    rewind: {
      target: {
        removeChildren: (removeArgs) => app.agents.removeChildren(removeArgs),
        removeShells: (removeArgs) => app.shells.removeShells(removeArgs),
        removeServices: (removeArgs) => app.services.removeServices(removeArgs),
      },
      truncate: (truncateArgs) => app.threads.rewind(truncateArgs),
    },
    agents: {
      say: (steer) => app.agents.say(steer),
      resume: (steer) => app.agents.resume(steer),
      stop: (steer) => app.agents.stop(steer),
    },
    processes: { shells: app.shells, services: app.services, cwd: args.cwd },
    operatorInput: app.operatorInput,
    compaction: app.compaction,
    rotation: app.surface.rotation,
    close: app.close,
  }
}
