import { describe, expect, it } from 'bun:test'

import {
  AUDIO_DONE_FRAME,
  ETranscriptPart,
  gatewayProtocolsOf,
  startFrameOf,
  transcriptPartOf,
} from '../gateway-protocol'

describe('gatewayProtocolsOf', () => {
  it('offers the transcription marker and carries the token as a subprotocol', () => {
    expect(gatewayProtocolsOf({ token: 'vcst_abc' })).toEqual([
      'ai-gateway-transcription.v1',
      'ai-gateway-auth.vcst_abc',
    ])
  })
})

describe('startFrameOf', () => {
  it('opens a 16 kHz PCM session', () => {
    expect(JSON.parse(startFrameOf({}))).toEqual({
      type: 'transcription-stream.start',
      inputAudioFormat: { type: 'audio/pcm', rate: 16000 },
    })
  })

  it('passes the spoken language through provider options', () => {
    expect(JSON.parse(startFrameOf({ language: 'en' })).providerOptions).toEqual({
      azure: { language: 'en' },
    })
  })

  it('marks the end of the audio', () => {
    expect(JSON.parse(AUDIO_DONE_FRAME)).toEqual({ type: 'transcription-stream.audio-done' })
  })
})

describe('transcriptPartOf', () => {
  it('reads a delta', () => {
    expect(transcriptPartOf({ frame: '{"type":"transcript-delta","delta":"Hello"}' })).toEqual({
      type: ETranscriptPart.Delta,
      delta: 'Hello',
    })
  })

  it('reads a partial, a final and a finish', () => {
    expect(transcriptPartOf({ frame: '{"type":"transcript-partial","text":"Hel"}' })).toEqual({
      type: ETranscriptPart.Partial,
      text: 'Hel',
    })
    expect(transcriptPartOf({ frame: '{"type":"transcript-final","text":"Hello"}' })).toEqual({
      type: ETranscriptPart.Final,
      text: 'Hello',
    })
    expect(transcriptPartOf({ frame: '{"type":"finish","text":"Hello","segments":[]}' })).toEqual({
      type: ETranscriptPart.Finish,
      text: 'Hello',
    })
  })

  it('reads the message of an error part', () => {
    expect(
      transcriptPartOf({
        frame: '{"type":"error","error":{"name":"AI_APICallError","message":"quota"}}',
      }),
    ).toEqual({ type: ETranscriptPart.Error, message: 'quota' })
  })

  it('names a failure that carries no message', () => {
    expect(transcriptPartOf({ frame: '{"type":"error"}' })).toEqual({
      type: ETranscriptPart.Error,
      message: 'The transcription service stopped.',
    })
  })

  it('ignores a malformed frame, an unknown part and a misplaced field', () => {
    expect(transcriptPartOf({ frame: 'not json' })).toBeUndefined()
    expect(transcriptPartOf({ frame: '{"type":"stream-start","warnings":[]}' })).toBeUndefined()
    expect(transcriptPartOf({ frame: '{"type":"transcript-delta"}' })).toBeUndefined()
  })
})
