import { DICTATION_SAMPLE_RATE, MAX_AUDIO_FRAME_BYTES } from './gateway-protocol'
import { micLevelOf } from './mic-level'

export const monoSamplesOf = ({
  samples,
  channels,
}: {
  samples: Int16Array
  channels: number
}): Int16Array => {
  if (channels < 2) return samples
  const frames = Math.floor(samples.length / channels)
  const mono = new Int16Array(frames)
  for (let index = 0; index < frames; index += 1) {
    let sum = 0
    for (let channel = 0; channel < channels; channel += 1) {
      sum += samples[index * channels + channel] ?? 0
    }
    mono[index] = Math.round(sum / channels)
  }
  return mono
}

export const resampledSamplesOf = ({
  samples,
  fromRate,
  toRate,
}: {
  samples: Int16Array
  fromRate: number
  toRate: number
}): Int16Array => {
  if (samples.length === 0 || fromRate === toRate || fromRate <= 0) return samples
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate))
  const step = fromRate / toRate
  const resampled = new Int16Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = index * step
    const left = Math.min(Math.floor(position), samples.length - 1)
    const right = Math.min(left + 1, samples.length - 1)
    const fraction = position - left
    const start = samples[left] ?? 0
    const end = samples[right] ?? start
    resampled[index] = Math.round(start + (end - start) * fraction)
  }
  return resampled
}

export interface IMicrophoneChunk {
  samples: Int16Array
  level: number
}

export const microphoneChunkOf = ({
  data,
  sampleRate,
  channels,
}: {
  data: ArrayBuffer
  sampleRate: number
  channels: number
}): IMicrophoneChunk => {
  const mono = monoSamplesOf({ samples: new Int16Array(data), channels })
  return {
    samples: resampledSamplesOf({
      samples: mono,
      fromRate: sampleRate,
      toRate: DICTATION_SAMPLE_RATE,
    }),
    level: micLevelOf({ samples: mono }),
  }
}

export const audioFramesOf = ({ samples }: { samples: Int16Array }): readonly Uint8Array[] => {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  const frames: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_AUDIO_FRAME_BYTES) {
    frames.push(bytes.subarray(offset, offset + MAX_AUDIO_FRAME_BYTES))
  }
  return frames
}
