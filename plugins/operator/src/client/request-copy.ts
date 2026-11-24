import type { OperatorRequestState } from '@dltech/atlas-client/transcript'

export const settledRequestTitleOf = (state: Exclude<OperatorRequestState, 'pending'>): string => {
  switch (state) {
    case 'delivered':
      return 'The operator answered'
    case 'cancelled':
      return 'The operator cancelled the request'
    case 'abandoned':
      return 'The session stopped waiting for your answer'
    case 'expired':
      return 'The request expired'
    case 'failed':
      return "Could not deliver the operator's value"
  }
}

export const answerRefusalOf = (args: { status: number | undefined }): string => {
  if (args.status === undefined) return 'the agent host could not be reached'
  if (args.status === 401) return 'this session is not signed in'
  if (args.status === 404) return `this session is unknown to the agent host (${args.status})`
  return `the agent host refused the answer (${args.status})`
}
