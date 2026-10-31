import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	schema: './conf/schema.ts',
	out: './conf/gen/drizzle',
	dialect: 'postgresql',
})
