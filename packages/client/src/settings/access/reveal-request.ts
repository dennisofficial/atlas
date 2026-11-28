export enum ERevealRequestStatus {
  Pending = 'pending',
  Cancelled = 'cancelled',
  Accepted = 'accepted',
}

export type RevealRequest = { id: number; status: ERevealRequestStatus }

export const beginRevealRequest = (previous: RevealRequest): RevealRequest => ({
  id: previous.id + 1,
  status: ERevealRequestStatus.Pending,
})

export const cancelRevealRequest = (request: RevealRequest): RevealRequest => ({
  ...request,
  status: ERevealRequestStatus.Cancelled,
})

export const revealRequestPending = ({
  request,
  id,
}: {
  request: RevealRequest
  id: number
}): boolean => request.id === id && request.status === ERevealRequestStatus.Pending

export const acceptRevealRequest = ({
  request,
  id,
}: {
  request: RevealRequest
  id: number
}): RevealRequest =>
  revealRequestPending({ request, id })
    ? { ...request, status: ERevealRequestStatus.Accepted }
    : request
