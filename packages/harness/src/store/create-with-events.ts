import type { EExecutionLocation, EventDraft, RunId, ThreadId } from '@dltech/atlas-core'

import type { SupervisedAgent } from './thread-store'

export class ThreadNeedsOpeningDrafts extends Error {
  constructor() {
    super(
      'a thread opened with its first events must be given at least one draft: an empty log reads as no one having spoken, so the thread would exist unable to ever take a step',
    )
    this.name = 'ThreadNeedsOpeningDrafts'
  }
}

export type OpenThreadArgs = {
  threadId?: ThreadId | undefined
  drafts: readonly EventDraft[]
  runId: RunId
  title?: string | undefined
  workspace?: string | undefined
  repo?: string | null | undefined
  executionLocation?: EExecutionLocation | undefined
  agent?: SupervisedAgent | undefined
}
