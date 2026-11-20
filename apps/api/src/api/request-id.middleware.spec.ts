import type { Logger } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import express from 'express'
import request from 'supertest'
import {
  REQUEST_ID_HEADER,
  currentRequestId,
  requestIdMiddleware,
  requestScopedLog,
  withRequestId,
} from './request-id.middleware'

const recordingLog = () => {
  const warnings: unknown[] = []
  const errors: unknown[] = []
  return {
    warnings,
    errors,
    log: {
      warn: (message: unknown) => {
        warnings.push(message)
      },
      error: (message: unknown) => {
        errors.push(message)
      },
    } satisfies Pick<Logger, 'warn' | 'error'>,
  }
}

const appWithScopedLog = (log: Pick<Logger, 'warn' | 'error'>) => {
  const app = express()
  app.use(requestIdMiddleware())
  app.get('/', (_incoming, response) => {
    const scoped = requestScopedLog(log)
    scoped.warn(new Error('mapped to 500'))
    response.json({ id: currentRequestId() })
  })
  return app
}

describe('requestIdMiddleware', () => {
  it('generates a request id and returns it in the response header', async () => {
    const response = await request(appWithScopedLog(recordingLog().log)).get('/')

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(/^req_[0-9a-f]{24}$/)
    expect(response.body.id).toBe(response.headers[REQUEST_ID_HEADER])
  })

  it('honours an incoming request id', async () => {
    const response = await request(appWithScopedLog(recordingLog().log))
      .get('/')
      .set(REQUEST_ID_HEADER, 'caller-supplied.1')

    expect(response.headers[REQUEST_ID_HEADER]).toBe('caller-supplied.1')
    expect(response.body.id).toBe('caller-supplied.1')
  })

  it('replaces an id that is not a safe header value', async () => {
    const response = await request(appWithScopedLog(recordingLog().log))
      .get('/')
      .set(REQUEST_ID_HEADER, `${'a'.repeat(200)}`)

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(/^req_[0-9a-f]{24}$/)
  })

  it('gives every request its own id', async () => {
    const first = await request(appWithScopedLog(recordingLog().log)).get('/')
    const second = await request(appWithScopedLog(recordingLog().log)).get('/')

    expect(first.headers[REQUEST_ID_HEADER]).not.toBe(second.headers[REQUEST_ID_HEADER])
  })
})

describe('requestScopedLog', () => {
  it('prefixes a log line with the request id', async () => {
    const { log, warnings } = recordingLog()

    await request(appWithScopedLog(log)).get('/').set(REQUEST_ID_HEADER, 'req_inside')

    expect(String(warnings[0])).toContain('req_inside Error: mapped to 500')
  })

  it('leaves a log line alone outside a request', () => {
    const { log, errors } = recordingLog()
    requestScopedLog(log).error('plain failure')
    expect(errors).toEqual(['plain failure'])
  })

  it('reads the id of the request it runs inside', () => {
    expect(currentRequestId()).toBeUndefined()
    expect(withRequestId('req_scoped', currentRequestId)).toBe('req_scoped')
    expect(currentRequestId()).toBeUndefined()
  })
})
