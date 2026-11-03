export enum ECallState {
  Unknown = 'unknown',
  Running = 'running',
  Done = 'done',
}

export enum EDaemonAnswer {
  Done = 'done',
  Running = 'running',
  NeverSeen = 'never-seen',
}

export enum ECallError {
  StaleEpoch = 'stale-epoch',
  RunWithoutRecord = 'run-without-record',
  AckWithoutResult = 'ack-without-result',
  SpawnWithoutJournal = 'spawn-without-journal',
}

export type SteppedCalls = {
  bootId: string
  epoch: number
  calls: Readonly<Record<string, ECallState>>
  journaled: ReadonlySet<string>
}

export const initialCalls = (args: { bootId: string }): SteppedCalls => ({
  bootId: args.bootId,
  epoch: 0,
  calls: {},
  journaled: new Set(),
})

export type CallStepInput =
  | { type: 'hello'; epoch: number }
  | { type: 'run'; key: string; dispatched: boolean; epoch: number }
  | { type: 'exit'; key: string; result: string }
  | { type: 'ack'; key: string; resultRecorded: boolean; epoch: number }
  | { type: 'cancel'; key: string; epoch: number }
  | { type: 'abandon'; key: string }
  | { type: 'daemonReboot'; bootId: string }

export type CallEffects = {
  spawned: readonly string[]
  journaled: readonly string[]
  deleted: readonly string[]
  cancelled: readonly string[]
  errors: readonly ECallError[]
}

export type SteppedCall = { state: SteppedCalls; effects: CallEffects }
