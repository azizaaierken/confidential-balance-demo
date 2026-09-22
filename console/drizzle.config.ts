import { defineConfig } from 'drizzle-kit';

// Only used for `bunx drizzle-kit studio` / inspection; the app creates its
// own tables on first connect (src/lib/server/db.ts).
export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/store/schema.ts',
	dbCredentials: { url: process.env.DATABASE_URL ?? '' }
});
