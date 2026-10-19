import { json, type RequestHandler } from 'express'

export const JSON_BODY_LIMIT = '4mb'

export const USER_FILE_BODY_LIMIT = '96mb'

export function userFileJsonParser(): RequestHandler {
  const parser = json({ limit: USER_FILE_BODY_LIMIT })
  return (request, response, next) => {
    if (request.method !== 'PUT') return next()
    return parser(request, response, next)
  }
}
