import type { ServicesLogInput, ServicesLogOutput } from '@dltech/atlas-protocol'

import { api, cloudCall } from '@/lib/api-client'

export const serviceLogKey = (args: { sessionId: string; serviceId: string }) =>
  ['v2-service-log', args.sessionId, args.serviceId] as const

export const fetchServiceLog = (input: ServicesLogInput): Promise<ServicesLogOutput> =>
  cloudCall(api.services.log.query(input))
