const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)

/**
 * The non-image media types the wire formats carry natively as file parts: Anthropic documents,
 * the responses API's input_file, and Google's inlineData all take a PDF; anything else a binary
 * sniff would find has no file block to ride and stays on the text path.
 */
export const NATIVE_FILE_MEDIA_TYPES = ['application/pdf'] as const

export type NativeFileMediaType = (typeof NATIVE_FILE_MEDIA_TYPES)[number]

export function nativeFileMediaType(bytes: Uint8Array): NativeFileMediaType | null {
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf'
  return null
}
