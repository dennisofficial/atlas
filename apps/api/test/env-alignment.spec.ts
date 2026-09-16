import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TIERS = ['local', 'staging', 'production'] as const
const RECOGNIZED_PLACEHOLDERS =
  /^<(not-needed-locally|via-personal-env|TODO-shared-value|TODO-pull-from-aws|TODO-pull-from-gcp)>$/

interface EnvEntry {
  key: string
  commented: boolean
  value: string
}

function parseTier(tier: (typeof TIERS)[number]): EnvEntry[] {
  const path = join(__dirname, '..', 'envs', `.env.api.${tier}.enc`)
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      commented: match[1] !== undefined,
      key: match[2] as string,
      value: (match[3] as string).replace(/^"|"$/g, ''),
    }))
    .filter((entry) => !entry.key.startsWith('DOTENV_PUBLIC_KEY'))
}

describe('env tier alignment', () => {
  it('holds the same keys in the same order across every tier', () => {
    const [local, ...rest] = TIERS.map(parseTier) as [EnvEntry[], ...EnvEntry[][]]
    for (const tier of rest) {
      expect(tier.map((entry) => entry.key)).toEqual(local.map((entry) => entry.key))
    }
  })

  it('comments every local value the tier does not supply, with a recognized reason', () => {
    for (const entry of parseTier('local')) {
      if (!entry.commented) continue
      expect(entry.value, `local:${entry.key}`).toMatch(RECOGNIZED_PLACEHOLDERS)
    }
  })

  it('comments every staging value with a recognized reason', () => {
    for (const entry of parseTier('staging')) {
      if (entry.key === 'APP_TIER' || entry.key === 'PORT') continue
      expect(entry.commented, `staging:${entry.key} must be commented`).toBe(true)
      expect(entry.value, `staging:${entry.key}`).toMatch(RECOGNIZED_PLACEHOLDERS)
    }
  })

  it('comments every value production does not supply, with a recognized reason', () => {
    for (const entry of parseTier('production')) {
      if (!entry.commented) continue
      expect(entry.value, `production:${entry.key}`).toMatch(RECOGNIZED_PLACEHOLDERS)
    }
  })

  it('encrypts every supplied value in every tier', () => {
    for (const tier of TIERS) {
      for (const entry of parseTier(tier)) {
        if (entry.commented) continue
        if (entry.key === 'APP_TIER' || entry.key === 'PORT') continue
        if (entry.key.startsWith('DOTENV_PUBLIC_KEY')) continue
        expect(entry.value, `${tier}:${entry.key}`).toMatch(/^encrypted:/)
      }
    }
  })
})
