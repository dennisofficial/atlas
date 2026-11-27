export interface ISendLock {
  acquire: () => boolean
  release: () => void
}

export const createSendLock = (): ISendLock => {
  let held = false
  return {
    acquire: () => {
      if (held) return false
      held = true
      return true
    },
    release: () => {
      held = false
    },
  }
}
