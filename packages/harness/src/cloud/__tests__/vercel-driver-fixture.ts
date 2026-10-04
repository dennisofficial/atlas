import { APIError } from '@vercel/sandbox'

import type { DriveSdk } from '../drive-lifecycle'
import { VercelDriver, type VercelSdk } from '../vercel-driver'
import { PINNED_VERSION, fakeSandbox } from './vercel-driver-sandbox-fixture'

export {
  PINNED_VERSION,
  fakeSandbox,
  ERecordedCallKind,
  type FakeSandbox,
  type RecordedCall,
} from './vercel-driver-sandbox-fixture'

export const CREDENTIALS = { token: 'vercel-token', teamId: 'team_1', projectId: 'prj_1' }

export const fakeDrive = ({ name, deleted }: { name: string; deleted?: string[] }) =>
  ({
    name,
    delete: async () => {
      deleted?.push(name)
    },
  }) as never

export const fakeDriveSdk = (
  over: Partial<DriveSdk> = {},
): { sdk: DriveSdk; created: string[]; deleted: string[] } => {
  const created: string[] = []
  const deleted: string[] = []
  return {
    created,
    deleted,
    sdk: {
      getOrCreate: async (params) => {
        created.push(params?.name ?? '')
        return fakeDrive({ name: params?.name ?? '', deleted: deleted })
      },
      list: async () =>
        (async function* () {
          yield* [] as never[]
        })(),
      ...over,
    },
  }
}

export const notFound = (): APIError<unknown> =>
  new APIError(new Response(null, { status: 404 }), { message: 'sandbox not found' })

export const notFoundForProject = (): APIError<unknown> =>
  new APIError(new Response(null, { status: 400 }), {
    json: { error: { message: "Sandbox 'atlas-thread-x' not found for this project." } },
  })

export const alreadyAttachedError = (): APIError<unknown> =>
  new APIError(new Response(null, { status: 409 }), {
    json: {
      error: {
        message:
          'Drive `atlas-drive-abc` is already attached as read-write to sandbox atlas-thread-abc',
      },
    },
  })

export const driverWith = ({
  sdk,
  driveSdk,
}: {
  sdk: Partial<VercelSdk>
  driveSdk?: DriveSdk
}): { driver: VercelDriver } => ({
  driver: new VercelDriver({
    credentials: CREDENTIALS,
    cloudUrl: 'https://api.example.com',
    image: `atlas-sandbox:${PINNED_VERSION}`,
    serveVersion: PINNED_VERSION,
    attachLagRetry: { attempts: 10, delayMs: 0 },
    driveSdk: driveSdk ?? fakeDriveSdk().sdk,
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

export const liveDriveSdk = () => {
  const deleted: string[] = []
  const live: unknown[] = []
  const sdk: DriveSdk = {
    getOrCreate: async (params) => {
      const drive = fakeDrive({ name: params?.name ?? '', deleted: deleted })
      live.push(drive)
      return drive
    },
    list: async () =>
      (async function* () {
        yield* live as never[]
      })(),
  }
  return { sdk, live, deleted }
}
