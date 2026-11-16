---
name: update-database-schema
description: Change the database schema. Use when adding, renaming, or removing a table, column, or enum in app/db/schema.ts.
---

The database is **disposable**. `data.db` is gitignored and holds nothing but seed data, so every schema change is free: migrate, throw the file away, reseed from scratch.

## Steps

1. **Edit the schema** — `app/db/schema.ts`.

2. **Generate the migration** — `npm run db:generate`. This writes a new numbered SQL file into `drizzle/`. Read it: every change from step 1 appears in it, and nothing else does.

3. **Update `scripts/seed.ts`** for every table you touched. The seed script defines the starting data, so it is part of the schema change, not a follow-up:
   - **New table** — add a `DROP TABLE IF EXISTS` line to the drop block at the top of `seed()`, positioned above the tables it has foreign keys into (children drop first), and insert rows for it.
   - **New non-nullable column** — give it a value in every `.values({ ... })` call for that table.
   - **Renamed or removed column** — rename or remove it at every insert site for that table.
   - **New enum** — import it from `../app/db/schema` and use its members at the insert sites, matching how `UserRole` and `CourseStatus` are used.

4. **Reseed** — `npm run db:seed`. It prints a summary of row counts when it finishes.

5. **Typecheck** — `npm run typecheck`.

Done when every table changed in step 1 is accounted for in step 3, `npm run db:seed` prints its summary, and the typecheck passes.

## When the seed fails to start

A half-applied migration, or tables left behind by another branch, can leave `data.db` in a state the seed cannot drop its way out of. Delete it and reseed:

```bash
rm -f data.db data.db-shm data.db-wal
npm run db:seed
```

Nothing is lost — the file is rebuilt from `drizzle/` and `scripts/seed.ts`.

## `npm run db:migrate`

`npm run db:migrate` applies pending migrations to the existing `data.db`, preserving the rows already in it. The seed already migrates before it inserts, so the steps above never need it. Reach for it when you specifically want to watch a migration land on existing data.
