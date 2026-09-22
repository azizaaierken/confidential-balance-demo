import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	if (params.id !== 'sender' && params.id !== 'receiver') error(404, 'unknown account');
	return { id: params.id as 'sender' | 'receiver' };
};
