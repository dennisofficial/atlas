import {
  parseClientMessage,
  type StreamClientMessage,
  type StreamParseResult,
} from '@dltech/atlas-protocol'

export type DecodedFrame = StreamParseResult<StreamClientMessage> | { ok: false; malformed: true }

export const frameBytes = (raw: string | Buffer): number =>
  typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength

export const decodeFrame = (raw: string | Buffer): DecodedFrame => {
  try {
    return parseClientMessage(JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')))
  } catch {
    return { ok: false, malformed: true }
  }
}
