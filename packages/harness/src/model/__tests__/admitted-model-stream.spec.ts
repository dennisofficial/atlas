import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'bun:test'

import { EAdmissionCompletion, PROBE_LEASE_MS } from '@dltech/atlas-core'

import {
  closeBarrier,
  delta,
  drain,
  finish,
  gatedStream,
  harness,
  key,
  quotaFault,
  revision,
  streamOf,
} from './admitted-model-fixture'

describe('admittedModel streaming', () => {
  it('completes a clean stream Succeeded exactly once', async () => {
    const rig = harness({})

    const { stream } = await rig.admitted.doStream({ prompt: [] })
    expect(await drain(stream)).toHaveLength(2)

    expect(rig.availability.completions).toEqual([{ outcome: EAdmissionCompletion.Succeeded }])
  })

  it('promotes a probe on its first error part and keeps forwarding the stream', async () => {
    const parts = [delta('a'), { type: 'error', error: quotaFault() } as const, delta('b'), finish]
    const rig = harness({ doStream: async () => streamOf(parts) })
    await closeBarrier(rig)

    const { stream } = await rig.admitted.doStream({ prompt: [] })
    const forwarded = await drain(stream)

    expect(forwarded.map((part) => part.type)).toEqual([
      'text-delta',
      'error',
      'text-delta',
      'finish',
    ])
    expect(rig.availability.promotions).toHaveLength(1)
    expect(rig.availability.completions).toHaveLength(1)
    expect(rig.availability.completions[0]?.outcome).toBe(EAdmissionCompletion.Failed)
  })

  it('completes Failed on a terminal error part after output began, once', async () => {
    const rig = harness({
      doStream: async () =>
        streamOf([
          delta('a'),
          { type: 'error', error: quotaFault() },
          { type: 'error', error: quotaFault() },
        ]),
    })

    const { stream } = await rig.admitted.doStream({ prompt: [] })
    await drain(stream)

    expect(rig.availability.completions).toHaveLength(1)
    expect(rig.availability.completions[0]).toMatchObject({ outcome: EAdmissionCompletion.Failed })
    expect(rig.availability.promotions).toHaveLength(0)
  })

  it('completes Cancelled when the reader cancels mid-stream', async () => {
    const gated = gatedStream({ head: [delta('a')] })
    const rig = harness({ doStream: async () => gated.result })

    const { stream } = await rig.admitted.doStream({ prompt: [] })
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel('stop')

    expect(rig.availability.completions).toEqual([{ outcome: EAdmissionCompletion.Cancelled }])
  })

  it('completes Cancelled when the abort signal fires before the stream closes', async () => {
    const controller = new AbortController()
    const rig = harness({
      doStream: async () => streamOf([delta('a')]),
    })

    const { stream } = await rig.admitted.doStream({
      prompt: [],
      abortSignal: controller.signal,
    })
    controller.abort()
    await drain(stream)

    expect(rig.availability.completions).toEqual([{ outcome: EAdmissionCompletion.Cancelled }])
  })

  it('resolves completion exactly once when cancel overlaps an error part', async () => {
    const gated = gatedStream({ head: [delta('a')] })
    const rig = harness({ doStream: async () => gated.result })

    const { stream } = await rig.admitted.doStream({ prompt: [] })
    const reader = stream.getReader()
    await reader.read()
    await Promise.all([reader.cancel('first'), reader.cancel('second')])

    expect(rig.availability.completions).toHaveLength(1)
  })

  it('never aborts a live stream when the probe lease expires underneath it', async () => {
    const gated = gatedStream({ head: [delta('a')] })
    const rig = harness({ doStream: async () => gated.result })
    await closeBarrier(rig)

    const { stream } = await rig.admitted.doStream({ prompt: [] })
    const reader = stream.getReader()
    await reader.read()

    rig.advance(PROBE_LEASE_MS + 1)
    const other = await rig.availability.admit({ key, revision })
    expect(other).toMatchObject({ admitted: true, permit: { probe: true } })

    gated.release([delta('b'), finish])
    const rest: LanguageModelV4StreamPart[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      rest.push(value)
    }

    expect(rest.map((part) => part.type)).toEqual(['text-delta', 'finish'])
    expect(rig.availability.completions).toEqual([{ outcome: EAdmissionCompletion.Succeeded }])
  })
})
