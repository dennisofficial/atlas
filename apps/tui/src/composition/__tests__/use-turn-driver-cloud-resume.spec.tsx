import { afterEach, describe, expect, it } from 'bun:test'
import { toRunId } from '@dltech/atlas-core'
import { ETurnStatus } from '@dltech/atlas-harness'
import { act } from 'react'

import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { mountCloudResume } from './cloud-resume-fixture'

afterEach(() => dismissNotice())

describe('cloud continuation ownership', () => {
  it('retires a pending interrupt when the sandbox reports that the turn ended', async () => {
    const mounted = await mountCloudResume({ holdTurn: true })
    try {
      await act(async () => {
        mounted.driver().handleResume()
        mounted.driver().handleInterrupt()
        mounted.channel.endTurn({
          status: ETurnStatus.Interrupted,
          runId: toRunId('resumed-run'),
          committed: true,
        })
        await mounted.driver().whenSettled()
      })
      mounted.channel.failTransport('unrelated reconnect error')
      expect(
        currentNotices().some((notice) => notice.text.includes('never acknowledged the interrupt')),
      ).toBe(false)
    } finally {
      await mounted.done()
    }
  })

  it('resumes interrupted output through the sandbox without writing the client transcript', async () => {
    const mounted = await mountCloudResume()
    try {
      expect(mounted.driver().isResumable).toBe(true)
      await mounted.perform(() => mounted.driver().handleResume())

      expect(mounted.writes).toEqual([])
      expect(mounted.runs).toEqual([{ resume: true }])
      expect(mounted.probe.failure).toBeNull()
      expect(await mounted.app.log.read({ threadId: mounted.channel.threadId })).toEqual(
        mounted.original,
      )
    } finally {
      await mounted.done()
    }
  })

  it('keeps Retry a bare run without attempting to rewrite history', async () => {
    const mounted = await mountCloudResume()
    try {
      await mounted.perform(() => mounted.driver().handleRetry())
      expect(mounted.runs).toEqual([undefined])
      expect(mounted.writes).toEqual([])
      expect(mounted.probe.failure).toBeNull()
    } finally {
      await mounted.done()
    }
  })

  it('surfaces a transcript read that dies against a parked sandbox as a failure, not unhandled', async () => {
    const mounted = await mountCloudResume({ holdTurn: true })
    try {
      const refused = Promise.reject(
        new Error('The read-events request was never answered: the sandbox is parked.'),
      )
      mounted.app.log.read = () => refused
      mounted.app.log.readOwn = () => refused
      await act(async () => {
        mounted.driver().handleResumeFresh()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(mounted.probe.failure).toBe('The read-events request was never answered: the sandbox is parked.')
    } finally {
      await mounted.done()
    }
  })

  it('ignores Resume and Retry when Ready says the sandbox is still running', async () => {    const mounted = await mountCloudResume()
    try {
      mounted.channel.ready({ turnInFlight: true })
      expect(mounted.driver().turnInFlight()).toBe(true)
      await mounted.perform(() => {
        mounted.driver().handleResume()
        mounted.driver().handleRetry()
      })
      expect(mounted.runs).toEqual([])
      expect(mounted.writes).toEqual([])
      expect(mounted.probe.failure).toBeNull()
    } finally {
      await mounted.done()
    }
  })

  it('ignores Resume and Retry when mounted onto an already working channel', async () => {
    const mounted = await mountCloudResume({ inFlightBeforeMount: true })
    try {
      expect(mounted.driver().turnInFlight()).toBe(true)
      await mounted.perform(() => {
        mounted.driver().handleResume()
        mounted.driver().handleRetry()
      })
      expect(mounted.runs).toEqual([])
      expect(mounted.writes).toEqual([])
    } finally {
      await mounted.done()
    }
  })
})
