import type { TRPCDefaultErrorShape, TRPCErrorFormatter } from '@trpc/server'
import { detailsOf } from './trpc-error-mapping'

export const apiErrorFormatter: TRPCErrorFormatter<object, TRPCDefaultErrorShape> = ({
  shape,
  error,
}) => ({ ...shape, data: { ...shape.data, details: detailsOf(error.cause) } })
