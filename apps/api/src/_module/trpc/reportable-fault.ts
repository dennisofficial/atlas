const MAX_CAUSE_DEPTH = 8
const STACK_FRAME = /^\s+at /

export const rootCauseOf = (failure: unknown): unknown => {
  let current = failure
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error) || current.cause === undefined) return current
    current = current.cause
  }
  return current
}

export const reportableFaultOf = (args: { failure: unknown; path: string }): Error => {
  const original = args.failure instanceof Error ? args.failure : undefined
  const fault = new Error(`${args.path} failed`)
  fault.name = original?.name ?? 'NonErrorThrown'
  const frames = (original?.stack ?? '').split('\n').filter((line) => STACK_FRAME.test(line))
  fault.stack = [`${fault.name}: ${fault.message}`, ...frames].join('\n')
  return fault
}
