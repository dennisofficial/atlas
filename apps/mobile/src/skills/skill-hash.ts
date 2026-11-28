import { bytesOfBase64 } from '@dltech/atlas-client/settings'
import * as Crypto from 'expo-crypto'
import { sha256Bytes } from '../auth/crypto-impl'

export const sha256HexOfBase64 = async (content: string): Promise<string> => {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytesOfBase64(content))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const sha256HexOfText = async (text: string): Promise<string> =>
  Array.from(await sha256Bytes(text), (byte) => byte.toString(16).padStart(2, '0')).join('')
