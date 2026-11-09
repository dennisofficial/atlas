export type ChildView = { id: number; hostWebviewId?: number | undefined }

export function childViewIdsOf(args: {
  views: readonly ChildView[]
  hostId: number | undefined
}): number[] {
  const { views, hostId } = args
  if (hostId === undefined) return []
  return views.filter((view) => view.hostWebviewId === hostId).map((view) => view.id)
}
