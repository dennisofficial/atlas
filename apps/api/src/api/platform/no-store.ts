import type { ApiTrpcCtx } from '../../_module/trpc/api-trpc-context'

export const markNoStore = (ctx: ApiTrpcCtx): void => {
  ctx.req.res?.setHeader('Cache-Control', 'no-store')
}
