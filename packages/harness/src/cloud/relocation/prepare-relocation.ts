import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'

export function prepareRelocation(args: {
  pause: () => void
  onTurnEnded: (listener: (outcome: TurnOutcome) => void) => () => void
  onFailure?: ((listener: (reason: string) => void) => () => void) | undefined
  deadlineMs?: number | undefined
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const offs: (() => void)[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let done = false
    const finish = (failure?: Error): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const off of offs) off()
      if (failure === undefined) resolve()
      else reject(failure)
    }
    offs.push(args.onTurnEnded((outcome) => {
      if (outcome.status === ETurnStatus.RelocationPaused) finish()
    }))
    if (args.onFailure !== undefined) {
      offs.push(args.onFailure((reason) => finish(new Error(reason))))
    }
    if (args.deadlineMs !== undefined) {
      timer = setTimeout(() => finish(new Error('the remote loops would not pause in time — nothing moved')), args.deadlineMs)
    }
    try {
      args.pause()
    } catch (failure) {
      finish(failure instanceof Error ? failure : new Error(String(failure)))
    }
  })
}
