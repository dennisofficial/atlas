const decoded = (bearer: string): string => {
  if (!bearer.includes('%')) return bearer
  try {
    return decodeURIComponent(bearer)
  } catch {
    return bearer
  }
}

export const rawSessionToken = (bearer: string): string | undefined => {
  const value = decoded(bearer.trim())
  const token = value.split('.')[0]?.trim()
  return token === undefined || token === '' ? undefined : token
}
