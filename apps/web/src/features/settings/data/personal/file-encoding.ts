export function utf8ToBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToUtf8(encoded: string): string {
  const binary = atob(encoded)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function encodeFileContent(
  text: string,
): Promise<{ content: string; contentHash: string }> {
  return {
    content: utf8ToBase64(text),
    contentHash: await sha256Hex(new TextEncoder().encode(text)),
  }
}
