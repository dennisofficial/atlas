import { createSettlePending } from './settle-pending'
import type { TrackedTurnDeps } from './tracked-turn-deps'
import type { TurnDeps } from './turn-deps'

export const trackedDepsOf = (deps: TurnDeps): TrackedTurnDeps => {
  const tools = deps.tools ?? (() => [])
  return {
    record: deps.record,
    modelContext: deps.modelContext,
    model: deps.model,
    ids: deps.ids,
    assembly: deps.assembly,
    tools,
    onChunk: deps.onChunk,
    streamOutput: deps.output,
    hooks: deps.hooks,
    uploads: deps.uploads,
    mediaUrls: deps.mediaUrls,
    intake: deps.intake,
    settlePending:
      deps.dispatch === undefined
        ? undefined
        : createSettlePending({
            record: deps.record,
            dispatch: deps.dispatch,
            tools,
            launchDirectory: deps.launchDirectory,
            onceLedger: deps.onceLedger,
            detachTool: deps.detachTool,
            podTool: deps.podTool,
            inProcess: deps.inProcess,
            onToolOutput:
              deps.output === undefined
                ? undefined
                : (output) => deps.output?.emit({ type: 'tool-output', output }),
          }),
    onceLedger: deps.onceLedger,
    applyLoopCut: deps.applyLoopCut,
    onLoopCut: deps.onLoopCut,
    watchLoop: deps.watchLoop,
    onLoopWatch: deps.onLoopWatch,
    onLoopWatchCut: deps.onLoopWatchCut,
    onLoopStop: deps.onLoopStop,
    launchDirectory: deps.launchDirectory,
    retry: deps.retry,
    waitState: deps.waitState,
    normalizeFailure: deps.normalizeFailure,
    trace: deps.trace,
  }
}
