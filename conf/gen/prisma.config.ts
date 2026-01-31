import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
	schema: 'conf/gen/schema.prisma',
	datasource: {
		url: env('DATABASE_URL'),
	},
})
