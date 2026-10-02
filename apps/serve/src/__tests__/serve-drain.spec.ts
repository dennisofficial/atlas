import { describe, expect, it } from 'bun:test'

import { EKilledBy, toThreadId } from '@dltech/atlas-core'

import { createServeDrain } from '../serve-drain'
import { EServeEvent, type ServeLogLine } from '../serve-log'

const threadId = toThreadId('drain-owner')

const gate = () => {
  let open = (): void => undefined
  const done = new Promise<void>((resolve) => { open = resolve })
  return { done, open }
}

const fixture = (over: {
  busy?: boolean
  settled?: () => Promise<void>
  endProcesses?: (args: { killedBy: EKilledBy }) => Promise<void>
  seal?: () => Promise<void>
  settleMs?: number
} = {}) => {
  const calls: string[] = []
  const lines: ServeLogLine[] = []
  const drain = createServeDrain({
    threadId,
    driver: {
      busy: () => over.busy ?? false,
      beginRelocation: () => { calls.push('begin-relocation') },
      settled: over.settled ?? (async () => { calls.push('settled') }),
    },
    closeAdmission: () => { calls.push('close-admission') },
    endProcesses: over.endProcesses ?? (async ({ killedBy }) => { calls.push(`endings:${killedBy}`) }),
    seal: over.seal ?? (async () => { calls.push('seal') }),
    retire: async ({ reason }) => { calls.push(`retire:${reason}`) },
    log: (line) => { lines.push(line) },
    settleMs: over.settleMs ?? 50,
    endingsMs: 50,
    replyFlushMs: 1,
  })
  return { calls, lines, drain }
}

describe('the rotation drain', () => {
  it('closes admission, freezes the loop, ends processes as rotation, then seals, in that order', async () => {
    const test = fixture({ busy: true })

    const result = await test.drain({ reason: 'protocol drift' })

    expect(result).toEqual({ ok: true, paused: true })
    expect(test.calls).toEqual([
      'close-admission',
      'begin-relocation',
      'settled',
      `endings:${EKilledBy.Rotation}`,
      'seal',
    ])
  })

  it('says nothing was paused when no turn was running', async () => {
    const test = fixture({ busy: false })

    expect(await test.drain({ reason: 'protocol drift' })).toEqual({ ok: true, paused: false })
  })

  it('waits for the paused turn to settle before it writes endings', async () => {
    const held = gate()
    const test = fixture({
      busy: true,
      settled: async () => { test.calls.push('settle-entered'); await held.done; test.calls.push('settle-left') },
      settleMs: 1_000,
    })

    const draining = test.drain({ reason: 'protocol drift' })
    await Bun.sleep(10)
    expect(test.calls).not.toContain(`endings:${EKilledBy.Rotation}`)
    held.open()
    await draining

    expect(test.calls.indexOf('settle-left')).toBeLessThan(test.calls.indexOf(`endings:${EKilledBy.Rotation}`))
  })

  it('stops waiting on a turn that never reaches its seam and still seals', async () => {
    const test = fixture({ busy: true, settled: () => new Promise<void>(() => undefined), settleMs: 20 })

    await test.drain({ reason: 'protocol drift' })

    expect(test.calls).toContain('seal')
  })

  it('keeps going and logs when ending the processes fails', async () => {
    const test = fixture({ endProcesses: async () => { throw new Error('pty gone') } })

    await test.drain({ reason: 'protocol drift' })

    expect(test.calls).toContain('seal')
    expect(test.lines).toContainEqual(expect.objectContaining({ event: EServeEvent.DrainStepFailed, step: 'endings', reason: 'pty gone' }))
  })

  it('keeps going and logs when the checkpoint cannot be sealed', async () => {
    const test = fixture({ seal: async () => { throw new Error('disk unavailable') } })

    expect(await test.drain({ reason: 'protocol drift' })).toEqual({ ok: true, paused: false })
    expect(test.lines).toContainEqual(expect.objectContaining({ event: EServeEvent.DrainStepFailed, step: 'seal' }))
  })

  it('retires the process only after the reply is ready, with the reason it was given', async () => {
    const test = fixture()

    await test.drain({ reason: 'protocol drift' })
    expect(test.calls).not.toContain('retire:protocol drift')
    await Bun.sleep(20)

    expect(test.calls.at(-1)).toBe('retire:protocol drift')
  })

  it('answers a second request that lands mid-drain with the same in-flight result and drains once', async () => {
    const held = gate()
    const test = fixture({ busy: true, settled: async () => { await held.done }, settleMs: 1_000 })

    const first = test.drain({ reason: 'protocol drift' })
    const second = test.drain({ reason: 'again' })
    held.open()

    expect(await first).toEqual({ ok: true, paused: true })
    expect(await second).toEqual({ ok: true, paused: true })
    expect(test.calls.filter((call) => call === 'close-admission')).toHaveLength(1)
    expect(test.calls.filter((call) => call === 'seal')).toHaveLength(1)
    await Bun.sleep(20)
    expect(test.calls.filter((call) => call.startsWith('retire:'))).toEqual(['retire:protocol drift'])
  })
})
