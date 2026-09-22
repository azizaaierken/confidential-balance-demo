import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		// Populated by src/hooks.server.ts from the IAP identity header; null
		// in local dev and when the app's visibility is public. Display-only.
		userEmail: locals.userEmail
	};
};
