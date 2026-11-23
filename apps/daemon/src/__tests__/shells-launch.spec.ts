import { describe, expect, it } from 'bun:test'

import { EShellRunStatus } from '@dltech/atlas-protocol'

import { shellEnd, shellOutput } from './exec-background-rig'
import { oomTarget, openSession } from './oom-rig'

describe('a shell a host launches', () => {
  it('runs its command in bash, so bash syntax works', async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      session.send({
        kind: 'run',
        key: 'bash-syntax',
        epoch: 1,
        op: {
          op: 'shells.launch',
          shellId: 'bash-syntax-shell',
          command: '[[ 1 == 1 ]] && echo ok',
          cwd: '/tmp',
        },
      })
      await session.until((frame) => frame.kind === 'result' && frame.key === 'bash-syntax')

      const ended = await shellEnd({ session, shellId: 'bash-syntax-shell' })
      expect(ended.status).toBe(EShellRunStatus.Exited)
      expect(ended.exitCode).toBe(0)
      expect(
        await shellOutput({ session, key: 'read-bash-syntax', shellId: 'bash-syntax-shell' }),
      ).toContain('ok')
    } finally {
      await handle.stop()
    }
  }, 30_000)
})
