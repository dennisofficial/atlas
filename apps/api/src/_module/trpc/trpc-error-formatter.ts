import type { TRPCDefaultErrorShape, TRPCErrorFormatter } from '@trpc/server'
import { detailsOf } from './trpc-error-mapping'

export const apiErrorFormatter: TRPCErrorFormatter<object, TRPCDefaultErrorShape> = ({
  shape,
  error,
}) => {
  const data = { ...shape.data }
  delete data.stack
  return { ...shape, data: { ...data, details: detailsOf(error.cause) } }
}
