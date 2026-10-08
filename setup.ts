// setup - thin entry for wizard - Deno-only
// - calls main from setup-wizard - no npm
import { main } from './setup/wizard.ts'

main().catch((err) => {
	console.error('Fatal error in wizard:', err)
	Deno.exit(1)
})
