const RUNNER_SCRIPT =
  /(?:^|&&|\|\||;|\|)\s*(?:bunx?|npm|pnpm|yarn|npx|deno|node)\s+(?:run\s+)?(?:dev|start|serve|storybook|watch|preview)\b/

const KNOWN_LONG_LIVED =
  /\b(?:storybook|vite|nodemon|uvicorn|gunicorn|pm2|json-server|live-server|http-server|hugo\s+server|jekyll\s+serve|rails\s+s(?:erver)?|flask\s+run|next\s+dev|nuxt\s+dev|astro\s+dev)\b/

const COMPOSE_UP = /\bdocker[-\s]compose\s+up\b/

const WATCH_FLAG = /\s--?watch(?:\s|=true|$)/

const BACKGROUNDED = /(?:\bnohup\b|&\s*$)/

export function serverShapeSuspected(command: string): boolean {
  if (RUNNER_SCRIPT.test(command)) return true
  if (KNOWN_LONG_LIVED.test(command)) return true
  if (COMPOSE_UP.test(command)) return true
  if (WATCH_FLAG.test(command)) return true
  return BACKGROUNDED.test(command)
}
