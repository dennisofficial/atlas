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

const NO_EFFECTS: CallEffects = { spawned: [], journaled: [], deleted: [], errors: [] }

const stateOf = (state: SteppedCalls, key: string): ECallState =>
  state.calls[key] ?? ECallState.Unknown

const withState = (state: SteppedCalls, key: string, call: ECallState): SteppedCalls => ({
  ...state,
  calls: { ...state.calls, [key]: call },
})

const failed = (state: SteppedCalls, error: ECallError): SteppedCall => ({
  state,
  effects: { ...NO_EFFECTS, errors: [error] },
})

export function stepCalls(args: { state: SteppedCalls; input: CallStepInput }): SteppedCall {
  const { state, input } = args

  if (input.type === 'daemonReboot') {
    return { state: initialCalls({ bootId: input.bootId }), effects: NO_EFFECTS }
  }

  if (input.type === 'journal') {
    if (stateOf(state, input.key) !== ECallState.Unknown) return { state, effects: NO_EFFECTS }
    const journaled = new Set(state.journaled)
    journaled.add(input.key)
    return {
      state: { ...withState(state, input.key, ECallState.Running), journaled },
      effects: { ...NO_EFFECTS, journaled: [input.key] },
    }
  }

  if (input.type === 'spawn') {
    if (stateOf(state, input.key) !== ECallState.Running || !state.journaled.has(input.key)) {
      return failed(state, ECallError.SpawnWithoutJournal)
    }
    const journaled = new Set(state.journaled)
    journaled.delete(input.key)
    return {
      state: { ...state, journaled },
      effects: { ...NO_EFFECTS, spawned: [input.key] },
    }
  }

  if (input.type === 'run') {
    if (input.bootId !== state.bootId) return failed(state, ECallError.BootChanged)
    if (input.epoch < state.epoch) return failed(state, ECallError.StaleEpoch)
    const nextState = { ...state, epoch: input.epoch }
    const known = stateOf(nextState, input.key)
    if (known !== ECallState.Unknown) return { state: nextState, effects: NO_EFFECTS }
    if (!input.dispatched) return failed(nextState, ECallError.RunWithoutRecord)
    const journaled = new Set(nextState.journaled)
    journaled.add(input.key)
    const running = withState(nextState, input.key, ECallState.Running)
    journaled.delete(input.key)
    return {
      state: { ...running, journaled },
      effects: { ...NO_EFFECTS, journaled: [input.key], spawned: [input.key] },
    }
  }

  if (input.type === 'exit') {
    if (stateOf(state, input.key) !== ECallState.Running) return { state, effects: NO_EFFECTS }
    return {
      state: withState(state, input.key, ECallState.Done),
      effects: NO_EFFECTS,
    }
  }

  if (input.epoch < state.epoch) return failed(state, ECallError.StaleEpoch)
  if (stateOf(state, input.key) !== ECallState.Done) return { state, effects: NO_EFFECTS }
  if (!input.resultRecorded) return failed(state, ECallError.AckWithoutResult)
  const calls = { ...state.calls }
  delete calls[input.key]
  const journaled = new Set(state.journaled)
  journaled.delete(input.key)
  return {
    state: { ...state, epoch: input.epoch, calls, journaled },
    effects: { ...NO_EFFECTS, deleted: [input.key] },
  }
}

export function answerCalls(state: SteppedCalls, key: string): EDaemonAnswer {
  const known = stateOf(state, key)
  if (known === ECallState.Done) return EDaemonAnswer.Done
  if (known === ECallState.Running) return EDaemonAnswer.Running
  return EDaemonAnswer.NeverSeen
}
