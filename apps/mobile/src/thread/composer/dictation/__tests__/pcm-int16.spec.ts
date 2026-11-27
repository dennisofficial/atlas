import { describe, expect, it } from 'bun:test'

import { MAX_AUDIO_FRAME_BYTES } from '../gateway-protocol'
import { audioFramesOf, microphoneChunkOf, monoSamplesOf, resampledSamplesOf } from '../pcm-int16'

const bytesOf = (samples: Int16Array): Uint8Array =>
  new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)

describe('monoSamplesOf', () => {
  it('keeps a mono stream as it is', () => {
    const samples = Int16Array.from([1, 2, 3])
    expect(monoSamplesOf({ samples, channels: 1 })).toBe(samples)
  })

  it('averages the channels of a stereo stream', () => {
    const samples = Int16Array.from([100, 200, -100, -200])
    expect([...monoSamplesOf({ samples, channels: 2 })]).toEqual([150, -150])
  })
})

describe('resampledSamplesOf', () => {
  it('keeps a stream already at the target rate', () => {
    const samples = Int16Array.from([1, 2, 3])
    expect(resampledSamplesOf({ samples, fromRate: 16000, toRate: 16000 })).toBe(samples)
  })

  it('halves a stream that arrives at twice the target rate', () => {
    const samples = Int16Array.from([0, 100, 200, 300, 400, 500, 600, 700])
    const resampled = resampledSamplesOf({ samples, fromRate: 32000, toRate: 16000 })
    expect(resampled).toHaveLength(4)
    expect([...resampled]).toEqual([0, 200, 400, 600])
  })

  it('stretches a stream that arrives slower than the target rate', () => {
    const resampled = resampledSamplesOf({
      samples: Int16Array.from([0, 300]),
      fromRate: 8000,
      toRate: 16000,
    })
    expect(resampled).toHaveLength(4)
    expect(resampled[0]).toBe(0)
    expect(resampled[3]).toBe(300)
  })

  it('reads an empty stream as empty', () => {
    expect(
      resampledSamplesOf({ samples: new Int16Array(0), fromRate: 48000, toRate: 16000 }),
    ).toHaveLength(0)
  })
})

describe('microphoneChunkOf', () => {
  it('turns a 32 kHz stereo buffer into 16 kHz mono samples and a level', () => {
    const interleaved = Int16Array.from(Array.from({ length: 3200 }, () => 16384))
    const chunk = microphoneChunkOf({
      data: interleaved.buffer,
      sampleRate: 32000,
      channels: 2,
    })
    expect(chunk.samples).toHaveLength(800)
    expect(chunk.level).toBeGreaterThan(0)
  })
})

describe('audioFramesOf', () => {
  it('sends a small buffer as one frame', () => {
    const samples = Int16Array.from([1, 2, 3])
    const frames = audioFramesOf({ samples })
    expect(frames).toHaveLength(1)
    expect([...bytesOf(samples)]).toEqual([...frames[0]!])
  })

  it('splits a long buffer under the server frame limit and loses no byte', () => {
    const samples = new Int16Array(MAX_AUDIO_FRAME_BYTES)
    const frames = audioFramesOf({ samples })
    expect(frames.length).toBe(2)
    for (const frame of frames) expect(frame.byteLength).toBeLessThanOrEqual(MAX_AUDIO_FRAME_BYTES)
    expect(frames.reduce((total, frame) => total + frame.byteLength, 0)).toBe(
      MAX_AUDIO_FRAME_BYTES * 2,
    )
  })
})
