# Prisma migrations

- Generate migrations with the Prisma CLI from changes to `schema.prisma`. From `apps/api`, use `bun run db:migrate --create-only --name <change>` against a development or disposable database.
- Hand-write SQL only when Prisma cannot express the required change, such as a data backfill or an unsupported database operation. Explain the need in the PR and keep the custom SQL limited to that operation.
- Keep the generator's SQL output, including its comments and formatting. Do not rewrite it for cosmetic cleanup.
- Review the generated SQL and verify that it applies before shipping.
- Do not edit migrations that have already been applied to shared databases. Generate a new migration instead.
- Do not use production databases for migration generation, reset, or shadow-database work.
