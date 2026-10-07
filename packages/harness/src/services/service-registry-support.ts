export const unknownService = (args: { serviceId: string; known: readonly string[] }): string => {
  const known = args.known.length === 0 ? 'none is registered' : args.known.join(', ')
  return `no service is registered as "${args.serviceId}"; known services: ${known}`
}

export const within = async (ms: number, promise: Promise<unknown>): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  await Promise.race([promise.then(() => undefined).catch(() => undefined), grace])
  clearTimeout(timer)
}

export const diedWithin = async (ms: number, promise: Promise<unknown>): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const grace = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  const died = await Promise.race([promise.then(() => true).catch(() => true), grace])
  clearTimeout(timer)
  return died
}
