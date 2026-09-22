export function solscanUrl(kind: 'tx' | 'account', value: string): string {
	return `https://solscan.io/${kind}/${value}?cluster=devnet`;
}

export function solscanHref(signature?: string, address?: string): string | undefined {
	return signature ? solscanUrl('tx', signature) : address ? solscanUrl('account', address) : undefined;
}
