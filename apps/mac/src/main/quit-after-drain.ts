export interface IQuitEvent {
  response?: { allow: boolean }
}

export interface IQuitAfterDrainDeps {
  stop: () => Promise<void>
  quit: () => void | Promise<void>
  onError: (error: unknown) => void
}

export function createQuitAfterDrain({
  stop,
  quit,
  onError,
}: IQuitAfterDrainDeps): (event: IQuitEvent) => void {
  let drained = false
  let draining: Promise<void> | undefined

  const drainThenQuit = async (): Promise<void> => {
    await stop()
    drained = true
    await quit()
  }

  return function handleBeforeQuit(event) {
    if (drained) return
    event.response = { allow: false }
    if (draining === undefined) draining = drainThenQuit().catch(onError)
  }
}
