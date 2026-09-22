/**
 * `vite dev` exposes `.env` only through `$env/dynamic/private`, not on
 * `process.env`; adapter-node in production exposes the container env on
 * both. The server modules read `process.env` so the same code also runs
 * under plain `bun scripts/*.ts` (which cannot import `$env`), so this
 * side-effect module copies Kit's view over once, never overwriting a value
 * the process already has. Imported by the API layer only.
 */
import { env } from '$env/dynamic/private';

for (const [key, value] of Object.entries(env)) {
	if (value !== undefined && process.env[key] === undefined) process.env[key] = value;
}
