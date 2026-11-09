import { describe, expect, it } from 'bun:test'

import { callOpSchema } from '../../ops'
import { journalOp, parseCallJournal } from '../call-store'

const SECRET = 'ghs_secret_value'
const REDACTED = '[redacted]'

const persists = (op: Parameters<typeof journalOp>[0]) => {
  const redacted = journalOp(op)
  expect(callOpSchema.safeParse(redacted).success).toBe(true)
  return redacted
}

describe('journalOp', () => {
  it('keeps a tunnel token out of the persisted previews.expose op', () => {
    const persisted = journalOp({ op: 'previews.expose', port: 3000, tunnelToken: 'secret' })
    expect(persisted).toEqual({ op: 'previews.expose', port: 3000, tunnelToken: REDACTED })
  })

  it('redacts every exec env value and keeps the names', () => {
    expect(
      persists({ op: 'exec', argv: ['sh', '-c', 'true'], env: { GH_TOKEN: SECRET, CI: '1' } }),
    ).toEqual({ op: 'exec', argv: ['sh', '-c', 'true'], env: { GH_TOKEN: REDACTED, CI: REDACTED } })
  })

  it('redacts the env of every op that starts a long-lived process', () => {
    expect(
      persists({ op: 'mcp.spawn', serverId: 'm', command: 'node', env: { TOKEN: SECRET } }),
    ).toEqual({ op: 'mcp.spawn', serverId: 'm', command: 'node', env: { TOKEN: REDACTED } })
    expect(
      persists({
        op: 'services.start',
        serviceId: 's',
        command: 'x',
        cwd: '/',
        env: { A: SECRET },
      }),
    ).toEqual({
      op: 'services.start',
      serviceId: 's',
      command: 'x',
      cwd: '/',
      env: { A: REDACTED },
    })
    expect(
      persists({ op: 'shells.launch', shellId: 's', command: 'x', cwd: '/', env: { A: SECRET } }),
    ).toEqual({ op: 'shells.launch', shellId: 's', command: 'x', cwd: '/', env: { A: REDACTED } })
  })

  it('redacts writeFile content and keeps the path and mode', () => {
    const redacted = persists({
      op: 'writeFile',
      path: '/root/.atlas-agent/github-token',
      content: SECRET,
      mode: 0o600,
    })
    expect(redacted).toEqual({
      op: 'writeFile',
      path: '/root/.atlas-agent/github-token',
      content: REDACTED,
      mode: 0o600,
    })
  })

  it('leaves an op with nothing secret as it is', () => {
    const op = { op: 'services.list' } as const
    expect(journalOp(op)).toBe(op)
    const plain = { op: 'exec', argv: ['echo', 'hi'] } as const
    expect(journalOp(plain)).toBe(plain)
  })

  it('still parses a journal written from a redacted op', () => {
    const op = journalOp({ op: 'writeFile', path: '/tmp/a', content: SECRET, mode: 0o600 })
    const journal = { format: 1, state: 'running', epoch: 1, op, outputBytes: 0 } as const
    expect(parseCallJournal(journal)).toEqual(journal)
  })
})
