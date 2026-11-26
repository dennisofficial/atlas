import type { ControlPlane } from '@dltech/atlas-control'
import type { RecordEvent, RecordEventType, ThreadId } from '@dltech/atlas-core'

const READ_PAGE = 1000

export const readPagesOf = async (args: {
  plane: ControlPlane
  threadId: ThreadId
  afterSeq: number
  visible: boolean
  hiddenTypes?: readonly RecordEventType[] | undefined
  onPage(events: readonly RecordEvent[]): Promise<void>
}): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
  let afterSeq = args.afterSeq
  for (;;) {
    const page = await args.plane.readEvents({
      threadId: args.threadId,
      afterSeq,
      limit: READ_PAGE,
      visible: args.visible,
      ...(args.hiddenTypes === undefined ? {} : { hiddenTypes: args.hiddenTypes }),
    })
    events.push(...page.events)
    await args.onPage(page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}
