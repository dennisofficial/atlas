import { describe, expect, it } from 'bun:test'
import {
  HEARTBEAT_TASK_ID,
  type HeartbeatOutput,
  heartbeatOutputSchema,
  heartbeatPayloadSchema,
} from '../index'

describe('heartbeat contract', () => {
  it('names the task id the trigger route deploys', () => {
    expect(HEARTBEAT_TASK_ID).toBe('heartbeat')
  })

  it('accepts an empty payload and returns it unchanged', () => {
    const payload = {}

    expect(heartbeatPayloadSchema.parse(payload)).toEqual({})
  })

  it('rejects a payload with fields the task never reads', () => {
    const parsed = heartbeatPayloadSchema.safeParse({ databaseUrl: 'postgres://example' })

    expect(parsed.success).toBe(false)
  })

  it('round-trips a heartbeat output', () => {
    const output: HeartbeatOutput = { taskId: HEARTBEAT_TASK_ID, databaseUrlPresent: true }

    const encoded = JSON.parse(JSON.stringify(heartbeatOutputSchema.parse(output)))

    expect(heartbeatOutputSchema.parse(encoded)).toEqual(output)
  })

  it('rejects an output naming another task', () => {
    const parsed = heartbeatOutputSchema.safeParse({
      taskId: 'github-poll-sweep',
      databaseUrlPresent: false,
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects an output that leaks the database url as a string', () => {
    const parsed = heartbeatOutputSchema.safeParse({
      taskId: HEARTBEAT_TASK_ID,
      databaseUrlPresent: 'postgres://example',
    })

    expect(parsed.success).toBe(false)
  })
})
