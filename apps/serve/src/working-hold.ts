export type WorkingHold = { take: () => void; release: () => void }

export function createWorkingHold(hold: (() => () => void) | undefined): WorkingHold {
  let release: (() => void) | undefined
  return {
    take: () => {
      release ??= hold?.()
    },
    release: () => {
      release?.()
      release = undefined
    },
  }
}
