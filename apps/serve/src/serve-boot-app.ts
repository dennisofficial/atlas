import type { ThreadId } from '@dltech/atlas-core'

import type { ServeArgs } from './serve-args'
import { collectNotices, recordNoticeEvents } from './container-notice-events'
import { bootServeFiles } from './serve-boot'
import { bootReporterFor, strictBootSinkFor, trackAgentStep } from './serve-boot-reporter'
import { composeBootApp } from './serve-compose-boot'
import { hydrateWhenRegistered } from './serve-hydrate'
import { apiThreadModel } from './serve-thread-model-boot'
import { bindServeWriteBehind } from './serve-write-behind'
import { EServeEvent, type LoggingNoticePort, type ServeLog } from './serve-log'
import { fileMountNoticeOf } from './file-mount-notice'
import { envSecretsNoticeOf } from './env-secrets-notice'
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
  try {
    const recovery = await createServeRotationRecovery({
      atlasHome,
      threadId,
      sandboxSessionId: args.sandboxSessionId,
      log,
    })
    const collected = collectNotices(notice)
    const prefetchedModel = apiThreadModel({ env, threadId, notice, ...remote })
    const { workspace, activeCwd, spec, identity, refreshCloudState, fileMounts } =
      await bootServeFiles({
        env,
        threadId,
        cwd,
        atlasHome,
        log,
        ensureWorkspace: serveArgs.ensureWorkspace,
        profile: serveArgs.profile,
        contextFiles: serveArgs.contextFiles,
        reporter,
        notice: collected.port,
        ...remote,
      })
    let hydrated: { remoteHead: number } | undefined
    const app = await trackAgentStep({
      reporter,
      strictSink: strictBootSinkFor({ env, ...remote }),
      work: async () => {
        const hydrateStartedAt = Date.now()
        hydrated = await hydrateWhenRegistered({
          env,
          atlasHome,
          threadId,
          log,
          ...remote,
        })
        log({ event: EServeEvent.BootPhase, phase: 'hydrate', ms: Date.now() - hydrateStartedAt })
        const composeStartedAt = Date.now()
        const composed = await composeBootApp({
          apiModel: prefetchedModel,
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
          fetchFn,
        })
        log({ event: EServeEvent.BootPhase, phase: 'compose', ms: Date.now() - composeStartedAt })
        return composed
      },
    })
    await recordNoticeEvents({ posts: collected.posts, threadId, app, log })
    const writeBehind = bindServeWriteBehind({
      env,
      app,
      threadId,
      durableHead: hydrated?.remoteHead ?? 0,
      remote,
      log,
    })
    const bootNotices = [
      {
        slot: 'project-file-mounts',
        content: fileMounts === null ? null : fileMountNoticeOf(fileMounts),
      },
      {
        slot: 'cloud-env-secrets',
        content: envSecretsNoticeOf(refreshCloudState.exportedEnvNames()),
      },
    ]
    for (const { slot, content } of bootNotices) {
      if (content === null) continue
      try {
        await app.log.append({
          threadId,
          runId: app.ids.nextRunId(),
          drafts: [{ type: 'context-loaded', slot, key: 'boot', content }],
        })
        app.channel.publisherFor({ threadId }).eventsAppended()
      } catch (failure) {
        log({
          event: EServeEvent.FileMountNoticeFailed,
          slot,
          reason: failure instanceof Error ? failure.message : String(failure),
        })
      }
    }
    return {
      app,
      recovery,
      workspace,
      fetchFn,
      clientVersion,
      writeBehind,
      refreshCloudState,
    }
  } catch (failure) {
    await reporter.flush()
    throw failure
  }
}
