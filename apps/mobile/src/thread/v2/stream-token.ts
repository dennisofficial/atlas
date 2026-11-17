import type { ApiClient } from '@dltech/atlas-api-router'

let held: ApiClient | undefined

export const setStreamClient = (client: ApiClient | undefined): void => {
  held = client
}

export const getStreamClient = (): ApiClient => {
  if (held === undefined) throw new Error('signed out')
  return held
}
