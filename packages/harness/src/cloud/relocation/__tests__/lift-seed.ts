import { toRunId } from '@dltech/atlas-core'

import { CLOUD_THREAD } from './fixture'
import type { Harness } from './lift-fixture'

export const seedLocalTranscript = async (
  test: Harness,
  texts: readonly string[] = ['take the linter to zero', 'and then ship it'],
): Promise<void> => {
  await test.localThreads.createWithFirstEvents({
    threadId: CLOUD_THREAD,
    runId: toRunId('run_local_seed'),
    drafts: texts.map((text) => ({ type: 'user-said' as const, text })),
    workspace: '/work',
  })
}
