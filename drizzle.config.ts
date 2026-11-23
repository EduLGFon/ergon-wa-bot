// Drizzle Kit config for the Postgres schema in conf/schema.ts.
// Points migrations/output at conf/gen/drizzle; dialect is postgresql.

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	schema: './conf/schema.ts',
	out: './conf/gen/drizzle',
	dialect: 'postgresql',
})
