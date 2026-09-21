import { describe, expect, it } from 'vitest'
import { driveNameFor, fallbackDriveNameFor, issueNumberOf } from './drive-names'

describe('driveNameFor', () => {
  it('names the drive after the repo and ticket number', () => {
    expect(driveNameFor({ repo: 'dennisofficial/factory-scratch', number: 12 })).toBe(
      'factory-dennisofficial-factory-scratch-12',
    )
  })

  it('lowercases and strips characters drive names cannot carry', async () => {
    expect(driveNameFor({ repo: 'Comp_AI/My Repo', number: 7 })).toBe('factory-comp-ai-my-repo-7')
  })

  it('caps the name so long repos still produce a legal drive name', () => {
    const name = driveNameFor({ repo: `${'a'.repeat(40)}/${'b'.repeat(40)}`, number: 12345 })
    expect(name.length).toBeLessThanOrEqual(60)
    expect(name.endsWith('-')).toBe(false)
  })
})

describe('fallbackDriveNameFor', () => {
  it('derives a legal name from the work item id', () => {
    expect(fallbackDriveNameFor({ workItemId: 'fwi_9f0c4f2e-1234-4abc-8def-0123456789ab' })).toBe(
      'factory-fwi-9f0c4f2e-1234-4abc-8def-0123456789ab',
    )
  })
})

describe('issueNumberOf', () => {
  it('reads the number off an issue external id', () => {
    expect(issueNumberOf('compai/atlas#341')).toBe(341)
  })

  it('declines pull-request and malformed ids', () => {
    expect(issueNumberOf('compai/atlas/pull/34')).toBeNull()
    expect(issueNumberOf('compai/atlas')).toBeNull()
    expect(issueNumberOf('compai/atlas#x')).toBeNull()
  })
})
