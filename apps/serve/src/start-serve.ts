import { atlasDirectory } from '@dltech/atlas-harness'

import type { ServeArgs, ServeHandle } from './serve-args'
import { finishServeBoot } from './serve-boot-finish'
import { listenWhileBooting } from './serve-boot-listener'
import { serveConfig } from './serve-config'
import { createServeLog, LoggingNoticePort } from './serve-log'

export async function startServe(args: ServeArgs = {}): Promise<ServeHandle> {
  const env = args.env ?? process.env
  const { threadId, port: wanted, token, controlPlaneUrl, cwd } = serveConfig({ ...args, env })
  const startedAt = Date.now()
  const log = createServeLog({ write: args.write })
  const notice = new LoggingNoticePort({ log })
  const driveHome = atlasDirectory()
  const sandboxSessionId = env.ATLAS_SANDBOX_SESSION_ID ?? ''
  const boot = listenWhileBooting({ port: wanted, token, threadId, sandboxSessionId, startedAt, log })

  try {
    return await finishServeBoot({
      serveArgs: args,
      env,
      threadId,
      token,
      controlPlaneUrl,
      cwd,
      startedAt,
      log,
      notice,
      driveHome,
      sandboxSessionId,
      boot,
    })
  } catch (failure) {
    boot.fail({ reason: failure instanceof Error ? failure.message : String(failure) })
    throw failure
  }
}
