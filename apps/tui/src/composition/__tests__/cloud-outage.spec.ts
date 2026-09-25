import { CloudError } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import { cloudOutageMessage, isCloudOutage } from '@dltech/atlas-harness'
import { diagnoseCredentialFailure } from '../credential-diagnosis'

describe('a cloud outage is a degradation, not a crash', () => {
  it('reads a 500 from the accounts endpoint as an outage', () => {
    const message = cloudOutageMessage(
      new CloudError({ status: 500, message: 'The Atlas Cloud API answered GET /v1/accounts.' }),
    )

    expect(message).toContain('answered GET /v1/accounts')
    expect(message).toContain('model access stays dark')
  })

  it('reads an unreachable cloud as an outage', () => {
    expect(
      isCloudOutage(new CloudError({ status: 0, message: 'could not be reached: ECONNREFUSED.' })),
    ).toBe(true)
  })

  it('reads a 401 as a dead session, not an outage', () => {
    const message = cloudOutageMessage(
      new CloudError({ status: 401, message: 'The Atlas Cloud API answered GET /v1/accounts with 401.' }),
    )

    expect(message).toContain('rejected the session')
    expect(message).toContain('/auth')
    expect(message).not.toContain('model access stays dark')
  })

  it('leaves anything that is not a cloud failure alone', () => {
    expect(cloudOutageMessage(new Error('the database is locked'))).toBeNull()
    expect(isCloudOutage('nope')).toBe(false)
  })

  it('lets boot carry on with a notice rather than dying', () => {
    const diagnosis = diagnoseCredentialFailure(
      new CloudError({ status: 500, message: 'The Atlas Cloud API answered GET /v1/accounts.' }),
    )

    expect(diagnosis).not.toBeNull()
    expect(diagnosis?.message).toContain('Atlas could not authenticate.')
    expect(diagnosis?.message).toContain('answered GET /v1/accounts')
  })
})
