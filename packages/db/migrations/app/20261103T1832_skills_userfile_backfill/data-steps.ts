import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Backfill Skill/SkillFile from UserFile tree=skills rows (newest copy wins)'

const TEXT_PATH_PATTERN =
  '\\.(md|txt|json|ya?ml|ts|tsx|js|jsx|mjs|cjs|toml|sh|py|rb|go|rs|css|html|xml|svg)$'

const PATH_PREFIX_FILTER = `'^\\.(agents|claude|atlas)/[^/]+/.+$'`

const parsedCtes = `WITH live AS (
  SELECT
    uf."userId",
    uf.revision,
    uf."contentHash",
    uf.content,
    uf."updatedAt",
    regexp_replace(uf.path, '^\\.(agents|claude|atlas)/', '') AS rel
  FROM "public"."UserFile" AS uf
  WHERE uf.tree = 'skills'
    AND uf."tombstonedAt" IS NULL
    AND uf.content IS NOT NULL
    AND uf.path ~ ${PATH_PREFIX_FILTER}
), ranked AS (
  SELECT
    live.*,
    lower(split_part(rel, '/', 1)) AS skill_name,
    substr(rel, strpos(rel, '/') + 1) AS file_path,
    row_number() OVER (
      PARTITION BY
        "userId",
        lower(split_part(rel, '/', 1)),
        substr(rel, strpos(rel, '/') + 1)
      ORDER BY "updatedAt" DESC, revision DESC
    ) AS rn
  FROM live
), winners AS (
  SELECT * FROM ranked WHERE rn = 1
)`

const loserCte = `, loser AS (
  SELECT ranked."userId", ranked.skill_name, ranked.file_path
  FROM ranked
  JOIN winners
    ON winners."userId" = ranked."userId"
   AND winners.skill_name = ranked.skill_name
   AND winners.file_path = ranked.file_path
  WHERE ranked.rn > 1 AND ranked."contentHash" <> winners."contentHash"
)`

const insertSql = `${parsedCtes}${loserCte}, inserted_skills AS (
  INSERT INTO "public"."Skill" (id, "userId", "projectId", name, description, "createdAt", "updatedAt")
  SELECT
    'skill_' || md5('skills-userfile-backfill-v1:' || skill_name || ':' || "userId") || gen_random_uuid()::text,
    "userId",
    NULL,
    skill_name,
    '',
    now(),
    now()
  FROM (SELECT DISTINCT "userId", skill_name FROM winners) AS distinct_skills
  ORDER BY "userId", skill_name
  ON CONFLICT DO NOTHING
  RETURNING id, "userId", name
), skill_rows AS (
  SELECT * FROM inserted_skills
  UNION ALL
  SELECT s.id, s."userId", s.name
  FROM "public"."Skill" AS s
  JOIN (SELECT DISTINCT "userId", skill_name FROM winners) AS distinct_skills
    ON s."userId" = distinct_skills."userId" AND s.name = distinct_skills.skill_name
  WHERE NOT EXISTS (
    SELECT 1 FROM inserted_skills AS i
    WHERE i."userId" = s."userId" AND i.name = s.name
  )
)
INSERT INTO "public"."SkillFile" (
  id,
  "skillId",
  path,
  revision,
  "contentHash",
  content,
  "isText",
  size,
  "createdAt",
  "updatedAt"
)
SELECT
  'skillfile_' || md5('skills-userfile-backfill-v1:' || winners."userId" || ':' || winners.skill_name || ':' || winners.file_path),
  skill_rows.id,
  winners.file_path,
  winners.revision,
  winners."contentHash",
  winners.content,
  winners.file_path ~* '${TEXT_PATH_PATTERN}',
  octet_length(winners.content),
  now(),
  now()
FROM winners
JOIN skill_rows
  ON skill_rows."userId" = winners."userId" AND skill_rows.name = winners.skill_name
ON CONFLICT ("skillId", path) DO NOTHING`

const divergentReportSql = `DO $$
DECLARE
  row_record RECORD;
BEGIN
  FOR row_record IN
    ${parsedCtes}${loserCte}
    SELECT "userId", skill_name, count(DISTINCT file_path) AS divergent_files, count(*) AS divergent_copies
    FROM loser
    GROUP BY "userId", skill_name
    ORDER BY "userId", skill_name
  LOOP
    RAISE WARNING 'skill %/%: % divergent copies across % files', row_record."userId", row_record.skill_name, row_record.divergent_copies, row_record.divergent_files;
  END LOOP;
END $$`

export const backfillSkillsFromUserFiles = rawSql({
  id: 'data.skills-userfile-backfill',
  invariantId: 'skills-userfile-backfill-v1',
  label,
  operationClass: 'data',
  target: {
    id: 'table.Skill',
    details: { schema: 'public', objectType: 'table' as const, name: 'Skill' },
  },
  precheck: [],
  execute: [
    {
      description: 'Warn about skills whose flavour copies diverged',
      sql: divergentReportSql,
    },
    {
      description: label,
      sql: insertSql,
    },
  ],
  postcheck: [],
})
