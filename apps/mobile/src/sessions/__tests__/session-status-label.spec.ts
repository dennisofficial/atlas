import { describe, expect, it } from 'bun:test'
import { ESessionDisplay } from '@dltech/atlas-client/stream'

import { rowStatusLabelOf, sessionStatusLabelOf } from '../session-status-label'

describe('rowStatusLabelOf', () => {
  it('leaves working, idle and the pod states to the status icon', () => {
    expect(rowStatusLabelOf(ESessionDisplay.Working)).toBeUndefined()
    expect(rowStatusLabelOf(ESessionDisplay.Idle)).toBeUndefined()
    expect(rowStatusLabelOf(ESessionDisplay.Starting)).toBeUndefined()
    expect(rowStatusLabelOf(ESessionDisplay.Parked)).toBeUndefined()
  })

  it('keeps the label for the states that ask for attention', () => {
    expect(rowStatusLabelOf(ESessionDisplay.WaitingForYou)).toBe('Waiting for you')
    expect(rowStatusLabelOf(ESessionDisplay.Failed)).toBe('Failed')
    expect(rowStatusLabelOf(ESessionDisplay.StartFailed)).toBe('Start failed')
  })

  it('has no label without a status', () => {
    expect(rowStatusLabelOf(undefined)).toBeUndefined()
  })

  it('keeps every label for the session header', () => {
    expect(sessionStatusLabelOf(ESessionDisplay.Working)).toBe('Working')
    expect(sessionStatusLabelOf(ESessionDisplay.Idle)).toBe('Idle')
    expect(sessionStatusLabelOf(ESessionDisplay.Parked)).toBe('Parked')
  })
})
