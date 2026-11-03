export interface IPkcePair {
  verifier: string
  challenge: string
  state: string
}

export interface IPkceCrypto {
  randomBytes: (length: number) => Uint8Array
  sha256Bytes: (value: string) => Promise<Uint8Array>
}

// https://datatracker.ietf.org/doc/html/rfc7636#section-4.1
export const base64UrlEncode = ({ bytes }: { bytes: Uint8Array }): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const defaultCrypto = async (): Promise<IPkceCrypto> => await import('./crypto-impl')

export const createPkcePair = async ({
  crypto,
}: {
  crypto?: IPkceCrypto
} = {}): Promise<IPkcePair> => {
  const impl = crypto ?? (await defaultCrypto())
  const verifier = base64UrlEncode({ bytes: impl.randomBytes(32) })
  return {
    verifier,
    challenge: base64UrlEncode({ bytes: await impl.sha256Bytes(verifier) }),
    state: base64UrlEncode({ bytes: impl.randomBytes(16) }),
  }
}

export const sha256Hex = async ({
  value,
  crypto,
}: {
  value: string
  crypto?: IPkceCrypto
}): Promise<string> => {
  const impl = crypto ?? (await defaultCrypto())
  const bytes = await impl.sha256Bytes(value)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
