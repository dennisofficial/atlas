import {
  EExecutionLocation,
  EKilledBy,
  EShellStatus,
  projectDirectoryOf,
  type IdPort,
  type LogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import { EPlacementMoveKind, PlacementBusy } from '../composition/placement-controller'
import type { AnchoringControl } from '../composition/sandbox-reanchor'
import type { DockerEngine } from './docker/engine'
import type { ServiceRegistryPort } from '../services/service-registry'
import { KILL_SETTLE_MS, type ShellRegistryPort } from '../shells/shell-registry'
import { logFieldsOf } from '../store/logs'
import { relocateSession, type RelocatedSession } from '../store/relocate-session'
import type { ThreadStorePort } from '../store/thread-store'

export type LocalPlacementMove = {
  from: EExecutionLocation
  to: EExecutionLocation
  killedShells: number
  moved: RelocatedSession
  stillDying: number
}

export type LocalPlacementRefusal = { ok: false; reason: string }
export type LocalPlacementResult = ({ ok: true } & LocalPlacementMove) | LocalPlacementRefusal

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The one host↔docker move, shared by the execution_location tool and the operator's own switch:
 * probe the destination before anything dies, freeze the family's stepping children only when the
 * caller asks to, kill the root's running shells, then relocate the session and commit the durable
 * placement — a failure before commit never writes it. Children relocate inside the same move and
 * resume only after the commit, so their routing is consistent the moment they step again.
 */
export async function moveLocalPlacement(args: {
  control: AnchoringControl
  threadId: ThreadId
  target: EExecutionLocation
  engine: Pick<DockerEngine, 'info'>
  ids: IdPort
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  /** The store-backed ports, resolved at call time: building the caller must not open a database. */
  stores: () => { threads: ThreadStorePort; log: Parameters<typeof relocateSession>[0]['log']; agents: AgentRegistryPort }
  caller?: ThreadId | undefined
  cwd?: string | undefined
  pause?: ((args: { threadId: ThreadId; caller: ThreadId | undefined }) => Promise<void>) | undefined
  whenSettled?: (() => Promise<void>) | undefined
  onProgress?: ((note: string) => void) | undefined
  logPort?: LogPort | undefined
}): Promise<LocalPlacementResult> {
  const { control, target } = args
  const stores = args.stores()

  let owner: ThreadId
  try {
    owner = await control.state.toolOwner(args.threadId)
  } catch (error) {
    return { ok: false, reason: messageOf(error) }
  }

  const from = control.state.of(owner) ?? control.state.current()

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
    return { ok: true, from, to: target, killedShells: 0, moved: emptyMove, stillDying: 0 }
  }

  if (target === EExecutionLocation.Docker) {
    try {
      await args.engine.info()
    } catch (error) {
      return {
        ok: false,
        reason: `the Docker daemon is not answering (${messageOf(error)}), so the session stays on ${from}`,
      }
    }
  }

  try {
    return await control.state.move({
      threadId: owner,
      target,
      kind: EPlacementMoveKind.Tools,
      work: async (transaction) => {
        const cwd = args.cwd ?? (await derivedCwd({ control, threadId: owner, log: stores.log }))

        if (args.pause !== undefined) {
          args.onProgress?.('pausing the session’s agents')
          await args.pause({ threadId: owner, caller: args.caller })
        }

        const killed = args.shells
          .list({ threadId: owner })
          .filter((shell) => shell.status === EShellStatus.Running)
        for (const shell of killed) {
          args.shells.kill({ shellId: shell.shellId, by: EKilledBy.ContainerSwitch, threadId: owner })
        }
        const shellEndings = args.shells.awaitEndings({ threadId: owner, ms: KILL_SETTLE_MS })

        if (args.whenSettled !== undefined) {
          args.onProgress?.('waiting for the session’s agents to settle')
          await args.whenSettled()
        }

        if (target === EExecutionLocation.Docker && cwd !== undefined) {
          args.onProgress?.('anchoring the sandbox to the session’s directory')
          await control.anchoring?.prepare({ cwd, threadId: owner })
        }

        let moved: RelocatedSession
        try {
          moved = await relocateSession({
            threadId: owner,
            from: transaction.from,
            location: target,
            cwd,
            caller: args.caller,
            log: stores.log,
            ids: args.ids,
            services: args.services,
            agents: stores.agents,
          })
        } catch (error) {
          args.logPort?.error({
            source: 'execution-location',
            message: `the move to ${target} failed (${messageOf(error)}) — no placement was committed`,
            threadId: owner,
            data: { from: transaction.from, to: target },
            ...logFieldsOf({ error }),
          })
          throw error
        }

        await stores.threads.chooseExecutionLocation({ threadId: owner, location: target })
        await transaction.commit()

        const stillDying = (await shellEndings) + moved.stillStopping
        return { from: transaction.from, to: target, killedShells: killed.length, moved, stillDying }
      },
    }).then((moved) => ({ ok: true as const, ...moved }))
  } catch (error) {
    if (error instanceof PlacementBusy) {
      return { ok: false, reason: error.message }
    }
    return {
      ok: false,
      reason: `the move to ${target} failed (${messageOf(error)}) — the session is back on ${from}`,
    }
  }
}

const derivedCwd = async (args: {
  control: AnchoringControl
  threadId: ThreadId
  log: Parameters<typeof relocateSession>[0]['log']
}): Promise<string | undefined> => {
  if (args.control.anchoring === undefined) return undefined

  return projectDirectoryOf({
    events: await args.log.read({ threadId: args.threadId }),
    launchDirectory: args.control.anchoring.launchDirectory,
  })
}

const emptyMove: RelocatedSession = { stoppedServices: [], relocatedAgents: [], stillStopping: 0 }
