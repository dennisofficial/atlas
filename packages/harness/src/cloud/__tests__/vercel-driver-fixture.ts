import { APIError } from '@vercel/sandbox'

import type { VercelSdk } from '@dltech/atlas-wire'
import { VercelDriver } from '../vercel-driver'
import { PINNED_VERSION, fakeSandbox } from './vercel-driver-sandbox-fixture'

export {
  PINNED_VERSION,
  fakeSandbox,
  ERecordedCallKind,
  type FakeSandbox,
  type RecordedCall,
} from './vercel-driver-sandbox-fixture'

export const CREDENTIALS = { token: 'vercel-token', teamId: 'team_1', projectId: 'prj_1' }

export const notFound = (): APIError<unknown> =>
  new APIError(new Response(null, { status: 404 }), { message: 'sandbox not found' })

export const notFoundForProject = (): APIError<unknown> =>
  new APIError(new Response(null, { status: 400 }), {
    json: { error: { message: "Sandbox 'atlas-thread-x' not found for this project." } },
  })

export const nameTakenError = (name = 'atlas-thread-x'): APIError<unknown> =>
  new APIError(new Response(null, { status: 400 }), {
    json: {
      error: {
        code: 'bad_request',
        message: `A sandbox with the name '${name}' already exists for this project. Use GET /sandboxes/:name to resume it or delete it first.`,
      },
    },
  })

export const driverWith = ({ sdk }: { sdk: Partial<VercelSdk> }): { driver: VercelDriver } => ({
  driver: new VercelDriver({
    credentials: CREDENTIALS,
    cloudUrl: 'https://api.example.com',
    image: `atlas-sandbox:${PINNED_VERSION}`,
    serveVersion: PINNED_VERSION,
    settleRetry: { attempts: 10, delayMs: 0 },
    sdk: {
      getOrCreate: sdk.getOrCreate ?? (async () => fakeSandbox()),
      get: sdk.get ?? (async () => fakeSandbox()),
    },
  }),
})

export const imageNotReady = (message: string): APIError<unknown> =>
  new APIError(new Response(null, { status: 409 }), {
    json: { error: { code: 'image_not_ready', message } },
  })
