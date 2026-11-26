import { cancelDebtsOf } from '../calls/cancel-debts'
import type { SessionRuntime } from './ports'
import { recordedStepsOf } from './record/call-steps'
import type { SessionRecord } from './record/record-adapter'

export const payCancelDebts = (args: { runtime: SessionRuntime; record: SessionRecord }): void => {
  const debts = cancelDebtsOf({
    events: args.record
      .eventCache()
      .eventsAfter(0)
      .flatMap((event) =>
        event.type === 'tool-dispatched' || event.type === 'tool-result' ? [event] : [],
      ),
    stepsOf: (scopeKey) => recordedStepsOf({ record: args.record, scopeKey }),
    daemonTools: args.runtime.daemonTools,
  })
  if (debts.length > 0) args.runtime.remoteCalls.cancelOwed(debts)
}
