let held: string | undefined

export const setStreamToken = (token: string | undefined): void => {
  held = token
}

export const getStreamToken = async (): Promise<string> => {
  if (held === undefined) throw new Error('signed out')
  return held
}
