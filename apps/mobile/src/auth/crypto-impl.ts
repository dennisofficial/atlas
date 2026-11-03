import * as Crypto from 'expo-crypto'

export const randomBytes = (length: number): Uint8Array => Crypto.getRandomBytes(length)

export const sha256Bytes = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(
    await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(value)),
  )
