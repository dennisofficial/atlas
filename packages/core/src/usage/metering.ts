import { EAuthKind, type Account } from '../credentials/account'

/** A plan meters a five-hour and a weekly window; a key bills per token and reports neither. */
export const isMetered = (account: Account): boolean => account.kind === EAuthKind.Oauth
