import { afterEach, describe, expect, it, mock, setSystemTime, spyOn } from 'bun:test'
import { Logger } from '@nestjs/common'
import { EGithubCallSource } from './github-call-log'
import { EGithubHttpCategory } from './github-observation.types'
import {
  EGithubBudgetRefusal,
  GithubCredentialCooldown,
  GithubHttpBudgetUnavailable,
  blockGithubRequests,
  isGithubBudgetParked,
  takeGithubRequestSlot,
  withGithubRequestBudget,
  type GithubHttpBudget,
} from './github-request-budget'

const NOW = new Date('2026-11-11T17:43:00.000Z')
const identity = {
  credentialFingerprint: 'fp',
  resource: 'core',
  category: EGithubHttpCategory.Refresh,
  source: EGithubCallSource.DeliveryFill,
}

const store = (overrides: Partial<GithubHttpBudget> = {}): GithubHttpBudget => ({
  takeHttpSlot: async () => true,
  httpCooldownUntil: async () => 0,
  blockHttpUntil: async () => undefined,
  ...overrides,
})

const refusalOf = async (args: GithubHttpBudget): Promise<unknown> =>
  withGithubRequestBudget({
    store: args,
    run: () => takeGithubRequestSlot(identity),
  }).catch((failure: unknown) => failure)

function captureWarnings(): string[] {
  const lines: string[] = []
  spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
    lines.push(String(message))
  })
  return lines
}

describe('takeGithubRequestSlot', () => {
  afterEach(() => {
    mock.restore()
    setSystemTime()
  })

  it('spends no slot and reports nothing when no budget is installed', async () => {
    await expect(takeGithubRequestSlot(identity)).resolves.toBeUndefined()
  })

  it('says GitHub still has quota when only Atlas’s own per-minute window is spent', async () => {
    setSystemTime(NOW)
    const warnings = captureWarnings()
    const failure = await refusalOf(store({ takeHttpSlot: async () => false }))

    expect(failure).toBeInstanceOf(GithubHttpBudgetUnavailable)
    const error = failure as GithubHttpBudgetUnavailable
    expect(error.refusal).toBe(EGithubBudgetRefusal.Window)
    expect(error.getStatus()).toBe(429)
    expect(error.message).toContain("this minute's budget is spent")
    expect(error.message).toContain('GitHub still has quota')
    expect(JSON.parse(warnings[0] ?? '')).toMatchObject({
      refusal: 'window',
      source: 'delivery-fill',
      category: 'refresh',
      resource: 'core',
    })
  })

  it('names the cooldown, its remaining minutes and when GitHub resets', async () => {
    setSystemTime(NOW)
    captureWarnings()
    const until = NOW.getTime() + 12 * 60_000
    const failure = await refusalOf(
      store({ takeHttpSlot: async () => false, httpCooldownUntil: async () => until }),
    )

    expect(failure).toBeInstanceOf(GithubCredentialCooldown)
    const error = failure as GithubCredentialCooldown
    expect(error.refusal).toBe(EGithubBudgetRefusal.Cooldown)
    expect(error.until).toBe(until)
    expect(error.message).toContain('GitHub rate-limited this connection')
    expect(error.message).toContain('12 more minutes')
    expect(error.message).toContain('until 17:55 UTC')
    expect(isGithubBudgetParked(error)).toBe(true)
  })

  it('blames the coordinator, not GitHub, when the shared budget cannot be read', async () => {
    setSystemTime(NOW)
    const warnings = captureWarnings()
    const failure = await refusalOf(
      store({
        takeHttpSlot: async () => {
          throw new Error('PR observation coordinator timed out')
        },
      }),
    )

    const error = failure as GithubHttpBudgetUnavailable
    expect(error.refusal).toBe(EGithubBudgetRefusal.Coordinator)
    expect(error.message).toContain('could not reach its GitHub request coordinator')
    expect(error.message).not.toContain('GitHub rate-limited')
    expect(JSON.parse(warnings[0] ?? '')).toMatchObject({
      refusal: 'coordinator',
      detail: 'Error: PR observation coordinator timed out',
    })
  })

  it('blames the coordinator when the cooldown lookup itself fails', async () => {
    setSystemTime(NOW)
    captureWarnings()
    const failure = await refusalOf(
      store({
        takeHttpSlot: async () => false,
        httpCooldownUntil: async () => {
          throw new Error('connection closed')
        },
      }),
    )

    expect((failure as GithubHttpBudgetUnavailable).refusal).toBe(EGithubBudgetRefusal.Coordinator)
  })
})

describe('blockGithubRequests', () => {
  afterEach(() => {
    mock.restore()
    setSystemTime()
  })

  it('records which call tripped the limit and forwards the cooldown', async () => {
    setSystemTime(NOW)
    const warnings = captureWarnings()
    const blocked: number[] = []
    const until = NOW.getTime() + 60_000

    await withGithubRequestBudget({
      store: store({
        blockHttpUntil: async (args) => {
          blocked.push(args.until)
        },
      }),
      run: () => blockGithubRequests({ ...identity, until }),
    })

    expect(blocked).toEqual([until])
    expect(JSON.parse(warnings[0] ?? '')).toMatchObject({
      blockedBy: 'delivery-fill',
      resource: 'core',
      until: '2026-11-11T17:44:00.000Z',
      inSeconds: 60,
    })
  })
})
