import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { CloudApiError } from '@/lib/cloud-api'

import { detailsTextOf, errorReportOf, newReferenceId, summaryOf, truncate } from '../error-report'

describe('summaryOf', () => {
  it('names the error and its message', () => {
    expect(summaryOf(new TypeError('x is undefined'))).toBe('TypeError: x is undefined')
  })

  it('says so when the error carries no message', () => {
    expect(summaryOf(new Error(''))).toBe('Error: (no message)')
  })

  it('truncates a long message', () => {
    expect(truncate('a'.repeat(10), 4)).toBe('aaa…')
  })

  it('keeps a message that fits', () => {
    expect(truncate('boom', 4)).toBe('boom')
  })
})

describe('errorReportOf', () => {
  it('keeps the generated reference id when the error has no digest', () => {
    const report = errorReportOf({ error: new Error('boom'), referenceId: 'err_generated' })
    expect(report.referenceId).toBe('err_generated')
    expect(report.requestId).toBeUndefined()
  })

  it('prefers the server digest, which the server logs also carry', () => {
    const error = Object.assign(new Error('boom'), { digest: '381726354' })
    expect(errorReportOf({ error, referenceId: 'err_generated' }).referenceId).toBe('381726354')
  })

  it('carries the API request id of a failed call', () => {
    const error = new CloudApiError({ message: 'nope', status: 500, requestId: 'req_abc' })
    expect(errorReportOf({ error, referenceId: 'err_generated' }).requestId).toBe('req_abc')
  })
})

describe('newReferenceId', () => {
  it('makes a distinct searchable id per error', () => {
    const first = newReferenceId()
    expect(first).toMatch(/^err_[0-9a-f]{12}$/)
    expect(first).not.toBe(newReferenceId())
  })
})

describe('detailsTextOf', () => {
  beforeEach(() => {
    process.env.ATLAS_WEB_COMMIT = '5cc4b0e9d1'
    process.env.ATLAS_WEB_VERSION = '1.179.4'
  })

  afterEach(() => {
    process.env.ATLAS_WEB_COMMIT = ''
    process.env.ATLAS_WEB_VERSION = ''
  })

  it('collects the summary, the references, the url and the interface version', () => {
    const report = errorReportOf({
      error: new CloudApiError({ message: 'boom', status: 500, requestId: 'req_abc' }),
      referenceId: 'err_generated',
    })
    const text = detailsTextOf({ report, url: 'https://byatlas.io/sessions/1' })

    expect(text).toContain('Error: boom')
    expect(text).toContain('Reference: err_generated')
    expect(text).toContain('Request: req_abc')
    expect(text).toContain('URL: https://byatlas.io/sessions/1')
    expect(text).toContain('Interface 1.179.4 · 5cc4b0e')
  })
})
