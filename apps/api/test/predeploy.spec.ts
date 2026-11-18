import { describe, expect, it } from 'bun:test'
import { runPredeploy } from '../scripts/predeploy.mjs'

const silentLog = () => {}

describe('runPredeploy', () => {
  it('migrates and then verifies, in that order', async () => {
    const calls: string[] = []
    const migrate = async (): Promise<number> => {
      calls.push('migrate')
      return 0
    }
    const verify = async (): Promise<number> => {
      calls.push('verify')
      return 0
    }

    const code = await runPredeploy({ migrate, verify, log: silentLog })

    expect(code).toBe(0)
    expect(calls).toEqual(['migrate', 'verify'])
  })

  it('stops before verify when the migration could not be applied', async () => {
    let verified = false
    const logs: string[] = []

    const code = await runPredeploy({
      migrate: async () => 1,
      verify: async () => {
        verified = true
        return 0
      },
      log: (message) => logs.push(message),
    })

    expect(code).toBe(1)
    expect(verified).toBe(false)
    expect(logs[0]).toContain('migration')
  })

  it('fails the deploy when the schema does not match the contract', async () => {
    const logs: string[] = []

    const code = await runPredeploy({
      migrate: async () => 0,
      verify: async () => 1,
      log: (message) => logs.push(message),
    })

    expect(code).toBe(1)
    expect(logs[0]).toContain('prisma db verify')
  })
})
