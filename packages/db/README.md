# @dltech/atlas-db

Atlas Cloud's Postgres contract, migrations and client, on Prisma 8. See `AGENTS.md` for the rules.

```sh
bun run contract:emit        # after any change under src/prisma/schema
bunx prisma migration plan --name <slug>
bun run db:test:up           # local test Postgres on :55441
bun run test
```

From `apps/api`, with the local tier env injected:

```sh
bun run db:up                # docker Postgres on :5433
bun run db:migrate           # prisma db migrate, advancing the db ref
bun run db:seed
```
