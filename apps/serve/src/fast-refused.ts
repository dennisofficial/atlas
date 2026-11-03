import { ENoticeTone, refKey, type NoticePort, type ThreadId } from '@dltech/atlas-core'
import { storedModel, type SelectableModel, type ThreadStorePort } from '@dltech/atlas-harness'

import type { ThreadModelPersister } from './serve-thread-model-persist'

const FAST_REFUSED_NOTICE =
  'Fast mode is off for this conversation — the provider refused it (fast-mode rate limit or usage credits). Continuing at standard speed.'

/**
 * A provider's fast-mode refusal flips the selection itself; this subscriber carries the fallback
 * to the transcript (whose model-chosen listener broadcasts it to attached clients), to the cloud
 * thread row, and to the operator as a notice.
 */
export function subscribeFastRefused(args: {
  model: SelectableModel
  threads: Pick<ThreadStorePort, 'chooseModel'>
  persist: ThreadModelPersister | undefined
  notice: NoticePort
  threadId: ThreadId
}): () => void {
  return args.model.onFastRefused(() => {
    const picked = args.model.choice()
    void args.threads
      .chooseModel({ threadId: args.threadId, model: storedModel(picked) })
      .then(() =>
        args.persist?.({
          ref: refKey(picked.ref),
          effort: picked.effort,
          ...(picked.fast === true ? { fast: true } : {}),
        }),
      )
      .catch(() => undefined)
    args.notice.notify({
      tone: ENoticeTone.Warn,
      key: 'fast-refused',
      text: FAST_REFUSED_NOTICE,
    })
  })
}
