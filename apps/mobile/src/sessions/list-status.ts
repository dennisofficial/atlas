export enum EListStatus {
  Loading = 'loading',
  Failed = 'failed',
  NoMatches = 'no-matches',
  NoSessions = 'no-sessions',
  Ready = 'ready',
}

export const listStatusOf = ({
  loading,
  failed,
  hasSessions,
  searching,
}: {
  loading: boolean
  failed: boolean
  hasSessions: boolean
  searching: boolean
}): EListStatus => {
  if (loading) return EListStatus.Loading
  if (failed) return EListStatus.Failed
  if (hasSessions) return EListStatus.Ready
  return searching ? EListStatus.NoMatches : EListStatus.NoSessions
}
