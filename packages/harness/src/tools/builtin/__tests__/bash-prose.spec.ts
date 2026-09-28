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
    expect(text).toContain('never resolves inside the container')
    expect(text).toContain('0.0.0.0')
  })

  it('notes that every port subdomain shares one site, for cookies and fetch', () => {
    const clauses = exposureClause({
      exposure: {
        containerPort: 3000,
        hostPort: 22211,
        url: 'http://3000.sandbox.localhost:22211',
      },
    })

    expect(clauses.join(' ')).toContain('same site')
  })
})
