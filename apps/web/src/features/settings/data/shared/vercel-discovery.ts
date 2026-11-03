import type { VercelTokenDiscover } from '@dltech/atlas-wire/web'

export const VERCEL_CREATE_TOKEN_URL = 'https://vercel.com/account/tokens'

export type VercelDiscovery = VercelTokenDiscover

export type VercelDiscoveryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; data: VercelDiscovery }
  | { status: 'failed'; message: string }

export const IDLE_DISCOVERY: VercelDiscoveryState = { status: 'idle' }

export type VercelDiscoverFn = (args: {
  token?: string | undefined
  teamId?: string | undefined
}) => Promise<VercelDiscovery>

export const teamsLoaded = (
  state: VercelDiscoveryState,
): state is {
  status: 'loaded'
  data: VercelDiscovery
} => state.status === 'loaded' && state.data.teams.length > 0
