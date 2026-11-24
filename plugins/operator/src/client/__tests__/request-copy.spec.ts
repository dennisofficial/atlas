import { describe, expect, it } from 'bun:test'

import { answerRefusalOf, settledRequestTitleOf } from '../request-copy'

describe('settledRequestTitleOf', () => {
  it('names each settled state the way web does', () => {
    expect(settledRequestTitleOf('delivered')).toBe('The operator answered')
    expect(settledRequestTitleOf('cancelled')).toBe('The operator cancelled the request')
    expect(settledRequestTitleOf('abandoned')).toBe('The session stopped waiting for your answer')
    expect(settledRequestTitleOf('expired')).toBe('The request expired')
    expect(settledRequestTitleOf('failed')).toBe("Could not deliver the operator's value")
  })
})

describe('answerRefusalOf', () => {
  it('says the host was unreachable when the failure carried no status', () => {
    expect(answerRefusalOf({ status: undefined })).toBe('the agent host could not be reached')
  })

  it('names a refused sign-in and an unknown session without echoing a wire code', () => {
    expect(answerRefusalOf({ status: 401 })).toBe('this session is not signed in')
    expect(answerRefusalOf({ status: 404 })).toBe('this session is unknown to the agent host (404)')
  })

  it('falls back to the status for every other refusal', () => {
    expect(answerRefusalOf({ status: 409 })).toBe('the agent host refused the answer (409)')
  })
})
