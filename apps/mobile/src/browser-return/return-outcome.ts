import { browserReturnOf, type ReturnOutcome, stateOfStartLink } from '@dltech/atlas-core'

export type AcceptedReturn = { state: string; outcome: ReturnOutcome }

export const acceptedReturnOf = (args: {
  startLink: string
  returnedUrl: string
}): AcceptedReturn | undefined => {
  const returned = browserReturnOf(args.returnedUrl)
  const state = stateOfStartLink(args.startLink)
  if (returned === undefined || state === undefined || returned.state !== state) return undefined
  return { state, outcome: returned.outcome }
}
