export const SKILL_ENTRY_PATH = 'SKILL.md'

const bytesOfUtf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

export const bytesOfBase64 = (content: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(content)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export const fromBase64Utf8 = (content: string): string =>
  new TextDecoder().decode(bytesOfBase64(content))

export const base64OfBytes = (bytes: Uint8Array<ArrayBuffer>): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const toBase64Utf8 = (text: string): string => base64OfBytes(bytesOfUtf8(text))
