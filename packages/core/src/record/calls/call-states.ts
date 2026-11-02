export enum ECallState {
  Unknown = 'unknown',
  Running = 'running',
  Done = 'done',
  Acked = 'acked',
}

export enum EDaemonAnswer {
  Done = 'done',
  Running = 'running',
  NeverSeen = 'never-seen',
}

export enum ECallError {
  BootChanged = 'boot-changed',
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
  | { type: 'journal'; key: string }
  | { type: 'spawn'; key: string }
  | { type: 'run'; key: string; dispatched: boolean; bootId: string; epoch: number }
  | { type: 'exit'; key: string; result: string }
  | { type: 'ack'; key: string; resultRecorded: boolean; epoch: number }
  | { type: 'daemonReboot'; bootId: string }

export type CallEffects = {
  spawned: readonly string[]
  journaled: readonly string[]
  deleted: readonly string[]
  errors: readonly ECallError[]
}

export type SteppedCall = { state: SteppedCalls; effects: CallEffects }
