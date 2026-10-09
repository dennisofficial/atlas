import {
  ClockPort,
  EAgentStatus,
  ENoticeTone,
  EventLogPort,
  EServiceStatus,
  EShellStatus,
  NOTICE_WARN_MS,
  ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { EFFORT_LADDER, parseRef } from '@dltech/atlas-core'

import { sandboxNameFor } from '@dltech/atlas-harness'
import { SelectableModelToken } from '@dltech/atlas-harness'
import { VercelDriver } from '@dltech/atlas-harness'
import { atlasDirectory, composeHarness } from '@dltech/atlas-harness'
import { loadSettings } from '@dltech/atlas-harness'
import { portToken, GithubUiBridgePort } from '@dltech/atlas-harness'
import { SecretsStoreToken, ServeSessionToken, SessionRegistryToken, SessionEnvironmentProcessPort } from '@dltech/atlas-harness'
import { ServiceRecovery } from '@dltech/atlas-harness'
import { liveServicesOf } from '@dltech/atlas-harness'
import { RotationPort, SessionAuthorityPort, ThreadStorePort, threadMentionFiles } from '@dltech/atlas-harness'

import { activateTransferredChildren, adoptTransferredChildren, holdFamilyIntake } from '@dltech/atlas-harness'
import { EPortableStateBoot, installPortableState } from './portable-state'
import type { ServeApp, ServeCompose, ServeModelBridge, ServePrStates, ServeSessionAuthority } from './serve-app'
import { ServeProcessPort } from './serve-process'
import { familyThreadIdsOf, stopWorkspaceProcessesFor, workspaceHooksFor } from './workspace-hooks'
import { vercelCredentialsOf } from './vercel-credentials'
import { serveMemoryArchive, serveSessionArchive } from './serve-session-archive'

export const SERVE_COMMAND = 'serve'

type ServeStores = {
  log: EventLogPort
  threads: ThreadStorePort
  modelBridge: ServeModelBridge
  authority?: ServeSessionAuthority | undefined
  rotation?: RotationPort | undefined
  prStates?: ServePrStates | undefined
}

/**
 * The shared root, bound for a sandbox: the transcript lives on the sandbox's own disk under its
 * atlas home, in the same JSONL stores a local session composes — and so do the credentials. The
 * portable-state bundle the lift staged on the drive is installed into that home before anything
 * reads it, so accounts, secrets, settings and MCP resolve through the container's local stores
 * and never through the API. The container skips host-source reconciliation for a serve launch
 * (see compose.ts), so the transferred vault is what the session runs on.
 */
export const composeServeApp: ServeCompose = async (args): Promise<ServeApp> => {
  const state = await installPortableState({})
  if (state.kind === EPortableStateBoot.Failed) {
    throw new Error(`atlas serve cannot start: ${state.reason}`)
  }
  if (state.kind === EPortableStateBoot.CleanupFailed) {
    args.notice.notify({
      key: 'serve:portable-state',
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `${state.reason}. Delete it inside the sandbox, or the next snapshot restore stages it again.`,
    })
  }
  if (
    state.kind === EPortableStateBoot.Installed ||
    state.kind === EPortableStateBoot.CleanupFailed
  ) {
    args.notice.notify({
      key: 'serve:portable-state',
      tone: ENoticeTone.Info,
      ttlMs: NOTICE_WARN_MS,
      text: `Installed the lifted local state (${state.install.written.length} files${
        state.install.skipped.length === 0
          ? ''
          : `, kept ${state.install.skipped.length} live`
      }).`,
    })
  }

  const app = await composeHarness<ServeStores>({
    repoIdentity: args.identity ?? null,
    userSkillHome: atlasDirectory(),
    bindPorts: ({ container }) => {
      container.register(ServeSessionToken, {
        useValue: { url: args.controlPlaneUrl, token: args.token, email: null },
      })
    },
    launch: {
      cwd: args.cwd,
      command: SERVE_COMMAND,
      model: args.model,
      executionLocation: undefined,
      threadId: args.threadId,
    },
    env: args.env,
    settings: loadSettings({ env: args.env, cwd: args.cwd }),
    clientVersion: args.clientVersion,
    surface: {
      notice: args.notice,
      bind: ({ container }) => {
        const log = container.resolve(portToken(EventLogPort))
        const threads = container.resolve(portToken(ThreadStorePort))
        const model = container.resolve(SelectableModelToken)
        const prStates = container.isRegistered(portToken(GithubUiBridgePort), true)
          ? {
              snapshot: () => container.resolve(portToken(GithubUiBridgePort)).service.states(),
              subscribe: (listener: () => void) =>
                container.resolve(portToken(GithubUiBridgePort)).service.subscribe(listener),
            }
          : undefined
        const modelBridge: ServeModelBridge = {
          effort: () => model.choice().effort,
          select: (next) => {
            const ref = parseRef(next.ref)
            if (ref === undefined) return
            const effort = EFFORT_LADDER.find((rung) => rung === next.effort) ?? model.choice().effort
            model.select({ ref, effort })
          },
        }

        const credentials = vercelCredentialsOf(args.env)
        container.register(portToken(ProcessPort), {
          useValue: new SessionEnvironmentProcessPort({
            sessions: container.resolve(SessionRegistryToken),
            inner: new ServeProcessPort(
              credentials === null
                ? null
                : {
                    driver: new VercelDriver({
                      credentials,
                      cloudUrl: args.controlPlaneUrl,
                    }),
                    name: sandboxNameFor({ threadId: args.threadId }),
                  },
            ),
          }),
        })

        const authority = container.isRegistered(portToken(SessionAuthorityPort), true)
          ? container.resolve(portToken(SessionAuthorityPort))
          : undefined
        const rotation = container.isRegistered(portToken(RotationPort), true)
          ? container.resolve(portToken(RotationPort))
          : undefined
        return { log, threads, modelBridge, authority, rotation, ...(prStates === undefined ? {} : { prStates }) }
      },
    },
  })

  const serviceRecovery = new ServiceRecovery({
    log: app.surface.log,
    ids: app.ids,
    live: () => liveServicesOf(app.services.list()),
  })

  const workspaceHooks = workspaceHooksFor({
    threadId: args.threadId,
    shells: app.shells,
    services: app.services,
    log: app.surface.log,
    threads: app.surface.threads,
    ids: app.ids,
  })

  const pausedChildren = new Set<ThreadId>()
  let releaseFamily: (() => void) | undefined

  return {
    channel: app.channel,
    runner: app.runner,
    turnPolicy: app.turnPolicy,
    log: app.surface.log,
    threads: app.surface.threads,
    modelBridge: app.surface.modelBridge,
    ledger: app.ledger,
    settings: app.settings,
    ids: app.ids,
    files: app.files,
    mentionFiles: (id) => threadMentionFiles({ threadId: id, log: app.surface.log, threads: app.surface.threads, launchDirectory: args.cwd }),
    workspace: app.workspace,
    pending: app.pending,
    ...(app.intake === undefined ? {} : { intake: app.intake }),
    sessionArchive: (options) => serveSessionArchive({ threadId: args.threadId, endFamilyShells: workspaceHooks.endFamilyShells, onBuildProgress: options?.onBuildProgress }),
    memoryArchive: () => serveMemoryArchive({ cwd: args.cwd, identity: args.identity ?? null }),
    adoptChildren: async ({ threadId, resumeChildren }) => {
      await adoptTransferredChildren({ agents: app.agents, threadId })
      return activateTransferredChildren({ agents: app.agents, log: app.surface.log, threadId, resumeChildren })
    },
    recordLostShells: ({ threadId }) => app.shells.reconcile({ threadId }),
    recordLostServices: ({ threadId }) => serviceRecovery.recordLost({ threadId }),
    recordLostAgents: ({ threadId }) => app.agents.recordLostAgents({ threadId }),
    whenChildrenSettled: ({ threadId }) => app.agents.whenChildrenSettled({ threadId }),
    family: {
      freeze: async ({ threadId }) => {
        releaseFamily ??= await holdFamilyIntake({ threadId, threads: app.surface.threads, intake: app.intake })
      },
      pauseChildren: async ({ threadId }) => {
        releaseFamily ??= await holdFamilyIntake({ threadId, threads: app.surface.threads, intake: app.intake })
        try {
          for (const child of await app.agents.pauseChildren({ threadId })) pausedChildren.add(child)
        } finally {
          const family = await familyThreadIdsOf({ root: threadId, threads: app.surface.threads })
          for (const child of app.agents.listEverywhere()) {
            if (family.has(child.spawnedBy) && child.status === EAgentStatus.Paused) pausedChildren.add(child.agentId)
          }
        }
      },
      resumeChildren: async () => {
        const roster = app.agents.listEverywhere()
        for (const agentId of pausedChildren) {
          const child = roster.find((entry) => entry.agentId === agentId)
          if (child === undefined) throw new Error(`paused child ${agentId} is missing from the family roster`)
          if (child.status === EAgentStatus.Paused) {
            const resumed = await app.agents.resume({ agentId, threadId: child.spawnedBy })
            if (!resumed.ok) throw new Error(resumed.reason)
          }
          pausedChildren.delete(agentId)
        }
        releaseFamily?.()
        releaseFamily = undefined
      },
    },
    runningChildren: () => app.agents.listEverywhere().filter((child) => child.status === EAgentStatus.Running).length,
    settlingWork: () => (app.agents.settling?.() ?? false) || (app.shells.settling?.() ?? false) || (app.services.settling?.() ?? false),
    pendingInput: () => app.pending.waitingCount() > 0 || (app.intake?.threadsWithPendingInput().length ?? 0) > 0,
    runningShells: () =>
      app.shells.listEverywhere().filter((shell) => shell.status === EShellStatus.Running).length,
    runningServices: () =>
      app.services.list().filter((service) => service.status === EServiceStatus.Running).length,
    executionLocation: app.executionLocation,
    endProcesses: ({ killedBy }) => stopWorkspaceProcessesFor({
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
    operatorInput: app.operatorInput,
    compaction: app.compaction,
    authority: app.surface.authority,
    rotation: app.surface.rotation,
    close: app.close,
  }
}
