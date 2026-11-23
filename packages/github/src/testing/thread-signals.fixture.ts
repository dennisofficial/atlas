export type RecordedSignals = {
  signals: { threadChanged(args: { threadId: string }): void }
  changedThreads: string[]
}

export function recordingSignals(): RecordedSignals {
  const changedThreads: string[] = []
  return {
    signals: {
      threadChanged: (args) => {
        changedThreads.push(args.threadId)
      },
    },
    changedThreads,
  }
}

export const inertSignals = (): RecordedSignals['signals'] => recordingSignals().signals
