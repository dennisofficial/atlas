export const AGENT_PARAM = 'agent'

export const PARENT_AGENT_PARAM = 'parent'

const paramOf = (args: { search: URLSearchParams; name: string }): string | undefined => {
  const value = args.search.get(args.name)
  return value === null || value.length === 0 ? undefined : value
}

export const agentParamOf = (search: URLSearchParams): string | undefined =>
  paramOf({ search, name: AGENT_PARAM })

export const parentAgentParamOf = (search: URLSearchParams): string | undefined =>
  paramOf({ search, name: PARENT_AGENT_PARAM })

export type AgentSearchArgs = {
  search: URLSearchParams
  agentId: string | undefined
  parentAgentId?: string | undefined
}

export const agentSearchOf = (args: AgentSearchArgs): URLSearchParams => {
  const next = new URLSearchParams(args.search)
  if (args.agentId === undefined) {
    next.delete(AGENT_PARAM)
    next.delete(PARENT_AGENT_PARAM)
    return next
  }
  next.set(AGENT_PARAM, args.agentId)
  if (args.parentAgentId === undefined) next.delete(PARENT_AGENT_PARAM)
  else next.set(PARENT_AGENT_PARAM, args.parentAgentId)
  return next
}

export const agentHrefOf = (args: AgentSearchArgs & { pathname: string }): string => {
  const query = agentSearchOf(args).toString()
  return query.length === 0 ? args.pathname : `${args.pathname}?${query}`
}
