# Testing

## Running tests

`npm test` runs the suite once; `npm run test:watch` watches. Narrow a run to one file, or one test by name:

```bash
npx vitest run app/services/courseService.test.ts
npx vitest run app/services/courseService.test.ts -t "returns published courses"
```

## Test database

`app/test/setup.ts` exports `createTestDb`, which builds a fresh in-memory SQLite database and applies the real migrations from `drizzle/`, keeping test and production schemas in sync. `seedBaseData` inserts a user, instructor, category, and course for tests to build on.

## Mocking `~/db`

Services import the shared `db` singleton, so tests mock the module with a getter — the binding stays live across `beforeEach` — and import the module under test **after** the mock:

```ts
let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getCourseById } from "~/services/courseService";

beforeEach(() => {
  testDb = createTestDb();
});
```

The import order is load-bearing: an import placed above the mock makes the service capture the real database, silently.

## Vitest config

Vitest runs with `globals: true` and `vite-tsconfig-paths`, so `describe`/`it`/`expect` need no import and `~/*` resolves in tests.
