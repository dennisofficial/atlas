import { describe, expect, it } from 'bun:test'

import { serverShapeSuspected } from '../service-shape'

describe('serverShapeSuspected', () => {
  it.each([
    'bun run dev',
    'npm start',
    'pnpm run storybook',
    'npx serve dist',
    'bunx vite',
    'next dev --port 3001',
    'storybook dev -p 6006',
    'uvicorn app:app --reload',
    'docker compose up',
    'docker-compose up -d',
    'tsc --watch',
    'nohup bun run server.ts',
    'bun run src/server.ts &',
  ])('suspects %s', (command) => {
    expect(serverShapeSuspected(command)).toBe(true)
  })

  it.each([
    'ls -la',
    'bun test',
    'bun run typecheck',
    'npm run build',
    'git status',
    'docker ps',
    'docker compose down',
    'curl https://example.dev/health',
    'vitest run --watch=false',
    'cat server.log',
  ])('passes %s', (command) => {
    expect(serverShapeSuspected(command)).toBe(false)
  })
})
