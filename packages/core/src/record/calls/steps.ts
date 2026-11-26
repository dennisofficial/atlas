export type StepFact = { key: string; op: string; digest: string }

export type StepPlan =
  | { kind: 'reuse'; key: string; index: number }
  | { kind: 'append'; key: string; index: number }

const DIGITS = /^\d+$/

const indexOfKey = (args: { key: string; position: number }): number => {
  const suffix = args.key.slice(args.key.lastIndexOf('.') + 1)
  return DIGITS.test(suffix) ? Number(suffix) : args.position
}

const highestIndexOf = (recorded: readonly StepFact[]): number =>
  recorded.reduce(
    (highest, fact, position) => Math.max(highest, indexOfKey({ key: fact.key, position })),
    -1,
  )

export function planStep(args: {
  scopeKey: string
  recorded: readonly StepFact[]
  consumed: ReadonlySet<string>
  op: string
  digest: string
  nextSlot: number
}): StepPlan {
  for (const [position, fact] of args.recorded.entries()) {
    if (args.consumed.has(fact.key)) continue
    if (fact.op !== args.op || fact.digest !== args.digest) continue
    return { kind: 'reuse', key: fact.key, index: indexOfKey({ key: fact.key, position }) }
  }
  const index = Math.max(args.nextSlot, highestIndexOf(args.recorded) + 1)
  return { kind: 'append', key: `${args.scopeKey}.${index}`, index }
}
