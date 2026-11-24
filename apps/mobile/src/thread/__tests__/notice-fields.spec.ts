import { describe, expect, it } from 'bun:test'

import { EAuthor, EEntryKind, type OperatorRequestEntry } from '@dltech/atlas-client/transcript'

import { ENoticeTone, noticeFieldsOf } from '../notice-fields'

const requestOf = (extra: Partial<OperatorRequestEntry> = {}): OperatorRequestEntry => ({
  kind: EEntryKind.OperatorRequest,
  author: EAuthor.Model,
  key: 'e1',
  text: 'asked the operator: Paste the login code',
  callId: 'call_1',
  prompt: 'Paste the login code',
  state: 'pending',
  ...extra,
})

describe('noticeFieldsOf for an operator request', () => {
  it('stays off the transcript while the request is pending', () => {
    expect(noticeFieldsOf(requestOf())).toBeNull()
  })

  it('turns a delivered answer into a quiet notice', () => {
    expect(noticeFieldsOf(requestOf({ state: 'delivered' }))).toEqual({
      title: 'The operator answered',
      body: 'Paste the login code',
      tone: ENoticeTone.Quiet,
    })
  })

  it('turns a failed delivery into a failed notice carrying the reason', () => {
    expect(noticeFieldsOf(requestOf({ state: 'failed', reason: 'the shell is gone' }))).toEqual({
      title: "Could not deliver the operator's value",
      body: 'the shell is gone',
      tone: ENoticeTone.Failed,
    })
  })

  it('says the session stopped waiting when the request was abandoned', () => {
    expect(noticeFieldsOf(requestOf({ state: 'abandoned' }))).toMatchObject({
      title: 'The session stopped waiting for your answer',
      tone: ENoticeTone.Quiet,
    })
  })
})
