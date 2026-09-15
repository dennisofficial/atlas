import type { EventDraft } from './body'
import type { Event, EventOfType } from './envelope'

export const LOOP_MIN_OCCURRENCES = 3
export const LOOP_MAX_UNIT_ROUNDS = 4
export const LOOP_NOTICE_STEPS = 3

export type RepeatableCall = { name: string; input: unknown }
export type Repeatable = (call: RepeatableCall) => boolean

export type LoopCut = {
  toSeq: number
  throughSeq: number
  repeats: number
  roundsCut: number
  names: readonly string[]
}

type ToolCalled = EventOfType<'tool-called'>
type Settlement = EventOfType<'tool-result'> | EventOfType<'tool-denied'>

type Round = {
  firstSeq: number
  lastSeq: number
  calls: readonly ToolCalled[]
  settlements: readonly Settlement[]
}

type Item = Round | 'barrier'

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

const settlementSignature = (settlement: Settlement): string => {
  if (settlement.type === 'tool-denied') {
    return stableStringify(['denied', settlement.name, settlement.reason])
  }
  return stableStringify([
    'result',
    settlement.name,
    settlement.modelText,
    settlement.output,
    settlement.error?.message,
    settlement.interrupted === true,
  ])
}

const sameRound = (left: Round, right: Round): boolean => {
  if (left.calls.length !== right.calls.length) return false
  if (left.settlements.length !== right.settlements.length) return false

  for (let index = 0; index < left.calls.length; index += 1) {
    const a = left.calls[index]
    const b = right.calls[index]
    if (a === undefined || b === undefined) return false
    if (a.name !== b.name) return false
    if (stableStringify(a.input) !== stableStringify(b.input)) return false
  }

  for (let index = 0; index < left.settlements.length; index += 1) {
    const a = left.settlements[index]
    const b = right.settlements[index]
    if (a === undefined || b === undefined) return false
    if (settlementSignature(a) !== settlementSignature(b)) return false
  }

  return true
}

const blankRound = (firstSeq: number): Round => ({
  firstSeq,
  lastSeq: firstSeq,
  calls: [],
  settlements: [],
})

const asRounds = (items: readonly Item[]): readonly Round[] | undefined =>
  items.some((item) => item === 'barrier') ? undefined : (items as readonly Round[])

function walkRounds(events: readonly Event[]): Item[] {
  const items: Item[] = []
  let current: Round | undefined

  const closeCurrent = () => {
    if (current === undefined) return
    const spoken = current.calls.length === 0 && current.settlements.length === 0
    items.push(spoken ? 'barrier' : current)
    current = undefined
  }

  for (const event of events) {
    if (event.type === 'assistant-said') {
      closeCurrent()
      current = blankRound(event.seq)
      continue
    }

    if (event.type === 'tool-called') {
      if (current === undefined || current.settlements.length > 0) {
        closeCurrent()
        current = blankRound(event.seq)
      }
      current.calls = [...current.calls, event]
      current.lastSeq = event.seq
      continue
    }

    if (event.type === 'tool-result' || event.type === 'tool-denied') {
      if (current === undefined || current.calls.length === 0) {
        closeCurrent()
        items.push('barrier')
        continue
      }
      current.settlements = [...current.settlements, event]
      current.lastSeq = event.seq
      continue
    }

    closeCurrent()
    items.push('barrier')
  }

  closeCurrent()
  return items
}

const settledRound = (round: Round): boolean =>
  round.calls.length > 0 && round.calls.length === round.settlements.length

const unitRepeatable = (unit: readonly Round[], repeatable: Repeatable): boolean =>
  unit.every((round) =>
    round.calls.every((call, index) => {
      if (round.settlements[index]?.type === 'tool-denied') return true
      return repeatable({ name: call.name, input: call.input })
    }),
  )

const namesOf = (unit: readonly Round[]): readonly string[] => [
  ...new Set(unit.flatMap((round) => round.calls.map((call) => call.name))),
]

/**
 * A turn that calls the same tool with the same input and gets the same result, repeatedly, with
 * nothing in between, is polling — and a generative model repeats whatever its own history shows,
 * so the repeats have to leave the log rather than be argued with. The first occurrence is the
 * information; everything after it is the loop, so the plan keeps the oldest unit and cuts the
 * rest of the run from the tail.
 *
 * Only a unit whose every call is `repeatable` may be cut: the predicate is the harness's proof
 * that deleting the repeats changes nothing outside the log.
 */
export function loopCutPlan({
  events,
  repeatable,
}: {
  events: readonly Event[]
  repeatable: Repeatable
}): LoopCut | undefined {
  const items = walkRounds(events)

  for (let unit = 1; unit <= LOOP_MAX_UNIT_ROUNDS; unit += 1) {
    let tail = items.length
    let occurrences = 0
    let anchor: readonly Round[] | undefined

    while (tail - unit >= 0) {
      const candidate = asRounds(items.slice(tail - unit, tail))
      if (candidate === undefined) break
      if (!candidate.every(settledRound)) break

      if (anchor === undefined) {
        if (!unitRepeatable(candidate, repeatable)) break
        anchor = candidate
      } else if (!unitMatches(candidate, anchor)) {
        break
      }

      occurrences += 1
      tail -= unit
    }

    if (anchor === undefined || occurrences < LOOP_MIN_OCCURRENCES) continue

    const kept = asRounds(items.slice(tail, tail + unit))
    const last = asRounds(items.slice(-1))?.[0]
    const keptLast = kept?.at(-1)
    if (keptLast === undefined || last === undefined) continue

    return {
      toSeq: keptLast.lastSeq,
      throughSeq: last.lastSeq,
      repeats: occurrences - 1,
      roundsCut: (occurrences - 1) * unit,
      names: namesOf(anchor),
    }
  }

  return undefined
}

const unitMatches = (unit: readonly Round[], anchor: readonly Round[]): boolean =>
  unit.length === anchor.length && unit.every((round, index) => {
    const expected = anchor[index]
    return expected !== undefined && sameRound(round, expected)
  })

export function loopCutNotice({ names, repeats }: { names: readonly string[]; repeats: number }): string {
  const tools = names.join(', ')
  return [
    `Atlas cut a runaway loop from this thread: ${tools} was called with identical input and returned an identical result ${repeats} times in a row, so those repeats were removed from the history you see — the first occurrence and its result are still above.`,
    `Do not resume the pattern. An identical call returning an identical result is polling, and a turn waits by ending, not by ticking: end the turn with no tool call, and the next event — a background shell ending, a check-in, a sub-agent report — will wake you.`,
  ].join(' ')
}

export function loopCutNoticeDraft(cut: { names: readonly string[]; repeats: number }): EventDraft {
  return { type: 'nudge', text: loopCutNotice(cut), lifetimeSteps: LOOP_NOTICE_STEPS }
}
