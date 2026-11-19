import type { RequestHandler, Response } from 'express'

const invalidAtlasB64 = (res: Response): void => {
  res.status(400).json({
    error: {
      message: 'invalid atlasB64 body',
      code: -32700,
      data: { code: 'BAD_REQUEST', httpStatus: 400 },
    },
  })
}

const encodedBodyOf = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'atlasB64') return undefined
  const encoded: unknown = Reflect.get(body, 'atlasB64')
  return typeof encoded === 'string' ? encoded : undefined
}

/** Unwraps the base64 body a createApiClient sends; any other body passes through untouched. */
export const decodeAtlasB64Body: RequestHandler = (req, res, next) => {
  const encoded = encodedBodyOf(req.body)
  if (encoded === undefined) return next()
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  } catch {
    return invalidAtlasB64(res)
  }
  req.body = parsed
  next()
}
