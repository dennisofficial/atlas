import { describe, expect, it } from 'bun:test'

import type { Attachment } from '../../attachments/attachment'
import { EAttachmentStore } from '../../attachments/attachment'
import { EMessageOrigin } from '../../events/body'
import { chainEvents } from '../chain-events'
import { v2EventSchema, type V2Body, type V2Event } from '../event'
import {
  inputMessageOfRow,
  inputMessageSchema,
  userSaidOf,
  type InputMessage,
} from '../input-message'
import { EMPTY_PENDING, pendingInputsOf, pendingMessagesOf } from '../pending-inputs'
import { NOW, runId, threadId } from './support'

const ATTACHMENT: Attachment = {
  id: 'a1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 10,
  content: { store: EAttachmentStore.Media, hash: 'a'.repeat(64) },
}

const fullMessage = (): InputMessage => ({
  text: 'ship it',
  attachments: [ATTACHMENT],
  clientId: 'c1',
  via: EMessageOrigin.ChildAgent,
  sender: { session: 'ses_child' },
})

const postedOf = (row: Record<string, unknown>): V2Body =>
  ({
    type: 'input-posted',
    inboxId: 7,
    kind: 'message',
    postedAt: NOW,
    ...row,
  }) as V2Body

const roundTrip = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({ threadId, runId, epoch: 3, at: NOW, bodies }).map((event) =>
    v2EventSchema.parse(JSON.parse(JSON.stringify(event))),
  )

describe('inputMessageSchema', () => {
  it('gives every field of the message shape a sample, so a new field cannot go untested', () => {
    const unsampled = Object.keys(inputMessageSchema.shape).filter(
      (key) => !Object.hasOwn(fullMessage(), key),
    )
    const parsed: InputMessage = inputMessageSchema.parse(fullMessage())
    expect(unsampled).toEqual([])
    expect(parsed).toEqual(fullMessage())
  })
})

describe('one input message from staging to user-said', () => {
  it('keeps the whole message through posted, pending and said', () => {
    const message = fullMessage()
    const [posted] = roundTrip([postedOf({ message })])
    const pending = pendingMessagesOf(pendingInputsOf([posted as V2Event]))
    expect(pending.map((entry) => entry.message)).toEqual([message])

    const said = pending.flatMap((entry): V2Body[] =>
      entry.message === undefined
        ? []
        : [userSaidOf({ inboxId: entry.inboxId, message: entry.message })],
    )
    const events = roundTrip([postedOf({ message }), ...said])
    const saidEvent = events[1]
    const saidMessage = saidEvent?.type === 'user-said' ? inputMessageOfRow(saidEvent) : undefined
    expect(saidMessage).toEqual(message)
    expect(pendingInputsOf(events)).toEqual(EMPTY_PENDING)
  })

  it('names the drain request after the inbox when none is given', () => {
    expect(userSaidOf({ inboxId: 7, message: { text: 'x' } }).requestId).toBe('inbox:7')
    expect(userSaidOf({ inboxId: 7, message: { text: 'x' }, requestId: 'r1' }).requestId).toBe('r1')
  })

  it('reads a flat row already in the log as the same message', () => {
    const message = fullMessage()
    const [legacy] = roundTrip([postedOf({ ...message })])
    const [pending] = pendingMessagesOf(pendingInputsOf([legacy as V2Event]))
    expect(pending?.message).toEqual(message)
  })

  it('prefers the nested message when a row somehow carries both', () => {
    const [posted] = roundTrip([postedOf({ message: { text: 'nested' }, text: 'flat' })])
    const [pending] = pendingMessagesOf(pendingInputsOf([posted as V2Event]))
    expect(pending?.message).toEqual({ text: 'nested' })
  })
})
