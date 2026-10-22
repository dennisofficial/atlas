import { EBootStep } from '@dltech/atlas-wire'

import type { ThreadId } from '@dltech/atlas-core'

import type { ServeArgs } from './serve-args'
import { bootServeFiles } from './serve-boot'
import { bootReporterFor } from './serve-boot-reporter'
import { composeBootApp } from './serve-compose-boot'
import { hydrateWhenApiProvisioned } from './serve-hydrate'
import { bindServeWriteBehind } from './serve-write-behind'
import type { LoggingNoticePort, ServeLog } from './serve-log'
import { createServeRotationRecovery } from './serve-rotation-recovery'

export async function bootServeApp(args: {
  serveArgs: ServeArgs
  env: Record<string, string | undefined>
  threadId: ThreadId
  token: string
  controlPlaneUrl: string
  cwd: string
  log: ServeLog
  notice: LoggingNoticePort
  atlasHome: string
  sandboxSessionId: string
}) {
  const { serveArgs, env, threadId, token, controlPlaneUrl, cwd, log, notice, atlasHome } = args
  const fetchFn = serveArgs.fetchFn ?? fetch
  const clientVersion = serveArgs.clientVersion ?? 'dev'
  const remote = { controlPlaneUrl, token, clientVersion, fetchFn }
  const reporter = bootReporterFor({ env, threadId, log, ...remote })
  const recovery = await createServeRotationRecovery({
    atlasHome,
    threadId,
    sandboxSessionId: args.sandboxSessionId,
    log,
  })
  const { workspace, activeCwd, spec, identity } = await bootServeFiles({
    env,
    threadId,
    cwd,
    atlasHome,
    log,
    ensureWorkspace: serveArgs.ensureWorkspace,
    profile: serveArgs.profile,
    contextFiles: serveArgs.contextFiles,
    reporter,
    ...remote,
  })
  let hydrated: { remoteHead: number } | undefined
  const app = await reporter.track({
    step: EBootStep.Agent,
    work: async () => {
      hydrated = await hydrateWhenApiProvisioned({ env, atlasHome, threadId, log, ...remote })
      return composeBootApp({
        compose: serveArgs.compose,
        model: serveArgs.model,
        spec,
        identity,
        threadId,
        cwd: activeCwd,
        atlasHome,
        controlPlaneUrl,
        token,
        clientVersion,
        env,
        notice,
      })
    },
  })
  const writeBehind = bindServeWriteBehind({
    env,
    app,
    threadId,
    durableHead: hydrated?.remoteHead ?? 0,
    remote,
    log,
  })
  return { app, recovery, workspace, fetchFn, clientVersion, writeBehind }
}
