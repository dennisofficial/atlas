import type { z } from 'zod'

import { UNREACHABLE } from './auth-api'

export class CloudApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(args: { message: string; status: number; code?: string | undefined }) {
    super(args.message)
    this.status = args.status
    this.code = args.code
  }
}

export enum EHttpMethod {
  Get = 'GET',
  Post = 'POST',
}

type CloudRequest = {
  method: EHttpMethod
  path: string
  body?: unknown
}

const messageOf = (body: Record<string, unknown>, fallback: string): string => {
  if (typeof body.message === 'string') return body.message
  if (Array.isArray(body.message) && typeof body.message[0] === 'string') return body.message[0]
  return fallback
}

async function send(args: CloudRequest): Promise<Response> {
  let response: Response
  try {
    response = await fetch(args.path, {
      method: args.method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: args.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
    })
  } catch {
    throw new CloudApiError({ message: UNREACHABLE, status: 0 })
  }
  if (response.ok) return response

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  throw new CloudApiError({
    message: messageOf(body, `Atlas Cloud answered ${response.status}`),
    status: response.status,
    code: typeof body.code === 'string' ? body.code : undefined,
  })
}

export async function cloudJson<TSchema extends z.ZodType>(
  args: CloudRequest & { schema: TSchema },
): Promise<z.infer<TSchema>> {
  const response = await send(args)
  return args.schema.parse(await response.json())
}

export async function cloudSend(args: CloudRequest): Promise<void> {
  await send(args)
}
