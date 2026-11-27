import { EDictationEvent, type IDictationSession, type TDictationEvent } from './dictation-engine'

export interface IDictationStep {
  atMs: number
  event: TDictationEvent
}

export const startScriptOf = ({
  steps,
  onEvent,
}: {
  steps: readonly IDictationStep[]
  onEvent: (event: TDictationEvent) => void
}): IDictationSession => {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let index = 0
  let interim = ''
  let open = true
  let scheduled = false

  const emit = (event: TDictationEvent) => {
    if (!open) return
    if (event.type === EDictationEvent.Partial) interim = event.text
    if (event.type === EDictationEvent.Final) interim = ''
    onEvent(event)
  }

  const advance = () => {
    while (open) {
      const step = steps[index]
      if (step === undefined) return
      const delay = startedAt + step.atMs - Date.now()
      if (delay > 0) {
        index += 1
        scheduled = true
        timer = setTimeout(() => {
          scheduled = false
          emit(step.event)
          advance()
        }, delay)
        return
      }
      index += 1
      emit(step.event)
    }
  }

  const clear = () => {
    if (scheduled && timer !== undefined) clearTimeout(timer)
    timer = undefined
    scheduled = false
  }

  const stop = async (): Promise<void> => {
    clear()
    const pending = interim
    interim = ''
    if (pending !== '') emit({ type: EDictationEvent.Final, text: pending })
    emit({ type: EDictationEvent.Ended })
    open = false
  }

  const cancel = () => {
    clear()
    open = false
  }

  advance()

  return { stop, cancel }
}
