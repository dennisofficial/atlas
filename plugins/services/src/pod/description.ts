export const SERVICES_DESCRIPTION = [
  'A service keeps serving until stopped, outlives the turn, never times out and never holds the turn open.',
  'Its ending arrives on its own: never poll, sleep or loop to wait.',
  '- start runs a service and returns its id at once. Pass name for a service declared in .atlas/services.yaml: it starts what that service needs first, runs its setup once and uses its command, workdir, env and port. Pass command for an ad-hoc one, never both. Not for work you are waiting on; a monitor that exits is a background shell. It gets PORT, so listen on $PORT. A port makes start wait until it answers, records it ready and publishes a public URL: give the operator that URL. exposePort false keeps it in the sandbox. Its stdin is closed and it is its own process group, so nothing it forks outlives a stop.',
  '- stop signals the whole process group, so anything it forked goes too. Pass serviceId or the name, exactly one. Do not wait for the ending.',
  '- restart stops it if running, then starts it under a new id. Pass serviceId or the name, exactly one. A name re-reads the declaration, so a changed command, env, port and health path apply and setup runs again. Restart after editing what it runs.',
  '- list names each service started here, running or ended, with id, name, state and port. runningOnly leaves out ended ones. A changed declaration shows stale; restart applies it. Do not poll: you are told when one ends.',
].join(' ')
