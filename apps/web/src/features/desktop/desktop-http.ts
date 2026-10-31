import { z } from 'zod'

import { isDesktopHost } from './desktop-attributes'

export class DesktopError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(args: { message: string; status: number; code?: string | undefined }) {
    super(args.message)
    this.status = args.status
    this.code = args.code
  }
}

export const hasDesktopHost = (): boolean => typeof window !== 'undefined' && isDesktopHost(window)

async function errorOf(response: Response): Promise<DesktopError> {
  const body: unknown = await response.json().catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return new DesktopError({
    message: typeof record.message === 'string' ? record.message : response.statusText,
    status: response.status,
    code: typeof record.code === 'string' ? record.code : undefined,
  })
}

export async function desktopRequest(args: {
  path: string
  method?: 'GET' | 'POST'
  body?: unknown
}): Promise<Response> {
  if (!hasDesktopHost()) throw new Error('This operation requires the Atlas Mac app')
  if (!/^\/desktop\/[A-Za-z0-9/_%?=&.-]+$/.test(args.path) || args.path.includes('..')) {
    throw new Error('Invalid desktop path')
  }
  const response = await fetch(args.path, {
    method: args.method ?? 'GET',
    credentials: 'same-origin',
    redirect: 'error',
    ...(args.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(args.body) }),
  })
  if (!response.ok) throw await errorOf(response)
  return response
}

export async function desktopCall<T>(args: {
  path: string
  schema: z.ZodType<T>
  method?: 'GET' | 'POST'
  body?: unknown
}): Promise<T> {
  const response = await desktopRequest(args)
  return args.schema.parse(await response.json())
}
