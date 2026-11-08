export enum ERenamed {
  Renamed = 'renamed',
  Empty = 'empty',
  Declined = 'declined',
}

export type Renaming =
  | { type: ERenamed.Renamed; name: string }
  | { type: ERenamed.Empty }
  | { type: ERenamed.Declined }

export const typedTitle = (argumentText: string): string | null => {
  const title = argumentText.replace(/\s+/g, ' ').trim()
  return title.length === 0 ? null : title
}
