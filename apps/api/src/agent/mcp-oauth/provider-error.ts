const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export const providerErrorOf = (args: {
  error: string
  description: string | undefined
  issuer: string
}): string => {
  const said =
    args.description === undefined || args.description === args.error
      ? args.error
      : `${args.description} (${args.error})`
  return `${hostOf(args.issuer)} answered: ${said}`
}
