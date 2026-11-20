const WRAPPED_KEY = 'atlasB64'

const unwrapped = (parsed: unknown): unknown => {
  if (typeof parsed !== 'object' || parsed === null) return parsed
  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== WRAPPED_KEY) return parsed
  const encoded = Reflect.get(parsed, WRAPPED_KEY)
  if (typeof encoded !== 'string') return parsed
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
}

export const trpcBodyOf = async (request: Request): Promise<unknown> =>
  unwrapped(await request.json())
