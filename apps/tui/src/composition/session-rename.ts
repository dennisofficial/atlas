export enum ERenamed {
  Renamed = 'renamed',
  Empty = 'empty',
  Declined = 'declined',
}

export type Renaming =
  | { type: ERenamed.Renamed; name: string }
  | { type: ERenamed.Empty }
  | { type: ERenamed.Declined }
