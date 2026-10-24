export const trpcUrl = ({
  controlPlaneUrl,
  procedure,
}: {
  controlPlaneUrl: string
  procedure: string
}) => `${controlPlaneUrl}/v1/trpc/${procedure}`

export const trpcOk = (data: unknown): Response => Response.json({ result: { data } })

export const trpcFailure = ({
  status,
  details,
  message = 'failed',
}: {
  status: number
  details?: Record<string, unknown>
  message?: string
}): Response =>
  Response.json(
    { error: { message, code: -32603, data: { code: 'ERROR', httpStatus: status, details } } },
    { status },
  )
