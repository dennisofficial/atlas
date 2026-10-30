import { describe, expect, it } from 'bun:test'

import { envSecretsNoticeOf } from '../env-secrets-notice'

describe('envSecretsNoticeOf', () => {
  it('stays silent when nothing was exported', () => {
    expect(envSecretsNoticeOf([])).toBeNull()
  })

  it('names every exported variable and never carries a value', () => {
    const notice = envSecretsNoticeOf(['DATABASE_URL', 'STRIPE_KEY'])
    expect(notice).toContain(
      'environment variables to your shells and services: DATABASE_URL, STRIPE_KEY.',
    )
    expect(notice).toContain('never print, log or commit their values')
  })
})
