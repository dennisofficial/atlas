import { sha256Bytes } from '../auth/crypto-impl'

export const sha256HexOfText = async (text: string): Promise<string> =>
  Array.from(await sha256Bytes(text), (byte) => byte.toString(16).padStart(2, '0')).join('')
