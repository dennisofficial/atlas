export interface IFinishRequest {
  request: (task: () => Promise<string>) => Promise<string>
}

export const createFinishRequest = (): IFinishRequest => {
  let pending: Promise<string> | null = null
  return {
    request: (task) => {
      if (pending !== null) return pending
      pending = task().finally(() => {
        pending = null
      })
      return pending
    },
  }
}
