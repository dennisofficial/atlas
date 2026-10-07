import { ENoticeTone } from '@dltech/atlas-core'

import { logFieldsOf } from '../../store/logs'
import { DESCEND_DESTROY_NOTICE_KEY, descendDestroyRetry } from './descend'
import type { DescendPlanArgs } from './descend-plan'

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

export async function finishSourceCleanup<Opened>(args: DescendPlanArgs<Opened>): Promise<void> {
  const cleanup = args.run.restoration?.cleanup
  if (cleanup === undefined) {
    void destroySandboxWithRetry(args).catch((error: unknown) => {
      args.logPort?.warn({ source: 'cloud.descend', message: 'the sandbox teardown retry itself failed — the warning notice stands', threadId: args.threadId, ...logFieldsOf({ error }) })
    })
    return
  }
  try {
    const verdict = await cleanup.verify()
    if (!verdict.safe) {
      args.notice.notify({
        key: DESCEND_DESTROY_NOTICE_KEY, tone: ENoticeTone.Warn, ttlMs: null,
        text: `The conversation and its family workspaces arrived locally. The cloud sandbox and drive were retained because source coverage could not be proven: ${verdict.reasons.join('; ')}. The retained cloud family remains frozen; no source data was removed.`,
      })
      return
    }
    await args.bridge.sandboxes.destroy({ threadId: args.threadId, expectedSandboxSessionId: cleanup.sourceSessionId })
  } catch (error) {
    args.notice.notify({ key: DESCEND_DESTROY_NOTICE_KEY, tone: ENoticeTone.Warn, ttlMs: null, text: `The family arrived locally, but cloud cleanup was refused or incomplete: ${messageOf(error)}. Unremoved source data was retained.` })
    args.logPort?.warn({ source: 'cloud.descend', message: 'the family source was retained after cleanup could not be verified', threadId: args.threadId, ...logFieldsOf({ error }) })
  }
}

async function destroySandboxWithRetry<Opened>(args: DescendPlanArgs<Opened>): Promise<void> {
  for (let attempt = 1; attempt <= descendDestroyRetry.attempts; attempt += 1) {
    try {
      await args.bridge.sandboxes.destroy({ threadId: args.threadId })
      if (attempt === 1) return
      args.notice.notify({ key: DESCEND_DESTROY_NOTICE_KEY, text: 'the cloud sandbox was torn down after all', tone: ENoticeTone.Success })
      return
    } catch (error) {
      args.logPort?.warn({ source: 'cloud.descend', message: 'the cloud sandbox could not be torn down', threadId: args.threadId, data: { operation: 'destroy-sandbox' }, ...logFieldsOf({ error }) })
      if (attempt === 1) args.notice.notify({ key: DESCEND_DESTROY_NOTICE_KEY, text: `this conversation is home, but its cloud sandbox could not be torn down — ${messageOf(error)}`, tone: ENoticeTone.Warn, ttlMs: null })
      if (attempt < descendDestroyRetry.attempts) await args.destroySleep(descendDestroyRetry)
    }
  }
}
