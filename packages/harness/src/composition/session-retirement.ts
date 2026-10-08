export type RetirementQueue<T extends { close?: (() => void) | undefined }> = {
  push: (binding: T) => void
  flush: () => void
  hold: () => () => void
}

export function createRetirementQueue<T extends { close?: (() => void) | undefined }>(): RetirementQueue<T> {
  const pending: T[] = []
  let holds = 0

  const flush = (): void => {
    if (holds > 0) return
    for (const binding of pending.splice(0)) {
      try {
        binding.close?.()
      } catch {
        continue
      }
    }
  }

  return {
    push: (binding) => {
      pending.push(binding)
    },
    flush,
    hold: () => {
      holds += 1
      let released = false
      return () => {
        if (released) return
        released = true
        holds -= 1
        flush()
      }
    },
  }
}
