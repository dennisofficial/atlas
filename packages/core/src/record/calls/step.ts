import {
  ECallError,
  ECallState,
  EDaemonAnswer,
  initialCalls,
  type CallEffects,
  type CallStepInput,
  type SteppedCall,
  type SteppedCalls,
} from './call-states'

export type StepVariant = {
  spawnWithoutJournal?: boolean
}

const NO_EFFECTS: CallEffects = {
  spawned: [],
  journaled: [],
  deleted: [],
  cancelled: [],
  errors: [],
}

const stateOf = (args: { state: SteppedCalls; key: string }): ECallState =>
  args.state.calls[args.key] ?? ECallState.Unknown

const withState = (args: { state: SteppedCalls; key: string; call: ECallState }): SteppedCalls => ({
  ...args.state,
  calls: { ...args.state.calls, [args.key]: args.call },
})

const failed = (args: { state: SteppedCalls; error: ECallError }): SteppedCall => ({
  state: args.state,
  effects: { ...NO_EFFECTS, errors: [args.error] },
})

export function stepCalls(args: {
  state: SteppedCalls
  input: CallStepInput
  variant?: StepVariant | undefined
}): SteppedCall {
  const { state, input, variant } = args

  if (input.type === 'daemonReboot') {
    return { state: initialCalls({ bootId: input.bootId }), effects: NO_EFFECTS }
  }

  if (input.type === 'hello') {
    if (input.epoch < state.epoch) return failed({ state, error: ECallError.StaleEpoch })
    if (input.epoch === state.epoch) return { state, effects: NO_EFFECTS }
    return { state: { ...state, epoch: input.epoch }, effects: NO_EFFECTS }
  }

  if (input.type === 'cancel') {
    if (input.epoch < state.epoch) return failed({ state, error: ECallError.StaleEpoch })
    if (stateOf({ state, key: input.key }) !== ECallState.Running) {
      return { state, effects: NO_EFFECTS }
    }
    return { state, effects: { ...NO_EFFECTS, cancelled: [input.key] } }
  }

  if (input.type === 'run') {
    if (input.epoch < state.epoch) return failed({ state, error: ECallError.StaleEpoch })
    const known = stateOf({ state, key: input.key })
    if (known !== ECallState.Unknown) return { state, effects: NO_EFFECTS }
    if (!input.dispatched) return failed({ state, error: ECallError.RunWithoutRecord })
    const skipsJournal = variant?.spawnWithoutJournal === true
    return {
      state: withState({ state, key: input.key, call: ECallState.Running }),
      effects: {
        ...NO_EFFECTS,
        journaled: skipsJournal ? [] : [input.key],
        spawned: [input.key],
      },
    }
  }

  if (input.type === 'exit') {
    if (stateOf({ state, key: input.key }) !== ECallState.Running) {
      return { state, effects: NO_EFFECTS }
    }
    return {
      state: withState({ state, key: input.key, call: ECallState.Done }),
      effects: NO_EFFECTS,
    }
  }

  if (input.epoch < state.epoch) return failed({ state, error: ECallError.StaleEpoch })
  if (stateOf({ state, key: input.key }) !== ECallState.Done) return { state, effects: NO_EFFECTS }
  if (!input.resultRecorded) return failed({ state, error: ECallError.AckWithoutResult })
  const calls = { ...state.calls }
  delete calls[input.key]
  return {
    state: { ...state, calls },
    effects: { ...NO_EFFECTS, deleted: [input.key] },
  }
}

export function answerCalls(args: { state: SteppedCalls; key: string }): EDaemonAnswer {
  const known = stateOf(args)
  if (known === ECallState.Done) return EDaemonAnswer.Done
  if (known === ECallState.Running) return EDaemonAnswer.Running
  return EDaemonAnswer.NeverSeen
}
