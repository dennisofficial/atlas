import { describe, expect, it } from 'bun:test'

import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { ETabSubject, offlineCopyOf } from '../offline-copy'

const pod = (state: EPodState): PodStatus => ({ state, steps: [] })

describe('offlineCopyOf', () => {
  it('says the sandbox is asleep when parked', () => {
    const copy = offlineCopyOf({ pod: pod(EPodState.Parked), subject: ETabSubject.Changes })
    expect(copy.title).toBe('Sandbox is asleep')
    expect(copy.description).toContain('Changes appear')
  })

  it('names the subject in the files copy', () => {
    const copy = offlineCopyOf({ pod: pod(EPodState.Booting), subject: ETabSubject.Files })
    expect(copy.description).toContain('Files appear')
  })

  it('invites a first message when there is no pod', () => {
    expect(offlineCopyOf({ pod: pod(EPodState.None), subject: ETabSubject.Files })).toEqual({
      title: 'No pod yet',
      description: 'Send a message to start a pod.',
    })
  })

  it('reports a failed pod', () => {
    expect(offlineCopyOf({ pod: pod(EPodState.Failed), subject: ETabSubject.Changes }).title).toBe(
      'Pod did not start',
    )
  })

  it('reads as connecting for a running pod without a channel, or unknown status', () => {
    expect(offlineCopyOf({ pod: pod(EPodState.Running), subject: ETabSubject.Files }).title).toBe(
      'Connecting to the pod',
    )
    expect(offlineCopyOf({ pod: null, subject: ETabSubject.Files }).title).toBe(
      'Connecting to the pod',
    )
  })

  it('ends one-line copy of four words or fewer without a period', () => {
    const titles = [EPodState.None, EPodState.Parked, EPodState.Booting, EPodState.Failed].map(
      (state) => offlineCopyOf({ pod: pod(state), subject: ETabSubject.Files }).title,
    )
    for (const title of titles) expect(title.endsWith('.')).toBe(false)
  })
})
