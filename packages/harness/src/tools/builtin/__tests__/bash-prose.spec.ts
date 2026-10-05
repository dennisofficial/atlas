import { describe, expect, it } from 'bun:test'

import { exposureClause } from '../bash-prose'

describe('the exposure clause', () => {
  it('says a plain localhost exposure is reachable on the operator’s machine', () => {
    const clauses = exposureClause({
      exposure: { containerPort: 3000, hostPort: 3000, url: 'http://localhost:3000' },
    })

    expect(clauses.join(' ')).toContain('operator’s machine')
    expect(clauses.join(' ')).toContain('http://localhost:3000')
  })

  it('explains the sandbox proxy contract when a proxy forwards to the container', () => {
    const clauses = exposureClause({
      exposure: {
        containerPort: 3000,
        hostPort: 22211,
        url: 'http://3000.sandbox.localhost:22211',
      },
    })
    const text = clauses.join(' ')

    expect(text).toContain('operator’s machine')
    expect(text).toContain('http://3000.sandbox.localhost:22211')
    expect(text).toContain('0.0.0.0')
    expect(text).toContain('never a localhost or sandbox-internal one')
    expect(text).toContain('resolves only on the operator’s machine')
    expect(text).toContain('proves nothing about what the operator can open')
    expect(text).toContain('one site')
  })
})
