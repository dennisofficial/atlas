import {
  applyServePriority,
  atlasDirectory,
  prepareWorkloadCgroups,
  sweepIdleWorkloadBoxes,
} from '@dltech/atlas-harness'

import { admitsFamilyThread } from './family-admission'
import type { ServeArgs, ServeHandle } from './serve-args'
import { finishServeBoot } from './serve-boot-finish'
import { listenWhileBooting } from './serve-boot-listener'
import { serveConfig } from './serve-config'
import { createServeLog, EServeEvent, LoggingNoticePort } from './serve-log'

const BOX_SWEEP_INTERVAL_MS = 60_000

export async function startServe(args: ServeArgs = {}): Promise<ServeHandle> {
  const env = args.env ?? process.env
  const { threadId, port: wanted, token, controlPlaneUrl, cwd } = serveConfig({ ...args, env })
  const startedAt = Date.now()
  const log = createServeLog({ write: args.write })
  const notice = new LoggingNoticePort({ log })
  const priority = applyServePriority({ env })
  if (priority.enabled) log({ event: EServeEvent.PriorityApplied, ...priority })
  const cgroups = prepareWorkloadCgroups({ env })
  if (cgroups.enabled) log({ event: EServeEvent.WorkloadCgroups, ...cgroups })
  const boxSweeper =
    cgroups.enabled && cgroups.ok
      ? setInterval(() => sweepIdleWorkloadBoxes({}), BOX_SWEEP_INTERVAL_MS)
      : undefined
  boxSweeper?.unref()
  const atlasHome = atlasDirectory()
  const sandboxSessionId = env.ATLAS_SANDBOX_SESSION_ID ?? ''
  const boot = listenWhileBooting({
    port: wanted,
    token,
    threadId,
    sandboxSessionId,
    startedAt,
    log,
    admitsThread: args.admitsThread ?? admitsFamilyThread({ root: threadId, atlasHome }),
  })

  try {
    const handle = await finishServeBoot({
      serveArgs: args,
      env,
      threadId,
      token,
      controlPlaneUrl,
      cwd,
      startedAt,
      log,
      notice,
      atlasHome,
      sandboxSessionId,
      boot,
    })
    return {
      ...handle,
      close: async (shutdown) => {
        clearInterval(boxSweeper)
        await handle.close(shutdown)
      },
    }
  } catch (failure) {
    clearInterval(boxSweeper)
    boot.fail({ reason: failure instanceof Error ? failure.message : String(failure) })
    throw failure
  }
}
