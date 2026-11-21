import { isMainThreadOnlyKind } from '@dltech/atlas-control'
import type { InboxEntry, ThreadId } from '@dltech/atlas-core'

export enum EIntakeScope {
  Main = 'main',
  Child = 'child',
}

export const intakeThreadOf = (args: {
  scope: EIntakeScope
  threadId: ThreadId
}): ThreadId | null => (args.scope === EIntakeScope.Main ? null : args.threadId)

export const skipsInChildScope = (entry: InboxEntry): boolean => isMainThreadOnlyKind(entry.kind)
