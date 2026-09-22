const DEFAULT_PAGE_SIZE = 5;

// Shared "5 items per page" logic for any list-shaped feed in the app
// (Recent Activity, the Audit Console's transfer and access-record lists) —
// one place to keep the page size and clamping consistent. `items` is a
// getter so the pagination tracks a reactive source.
export class Pagination<T> {
	page = $state(0);
	readonly pageSize: number;
	#items: () => T[];

	constructor(items: () => T[], pageSize: number = DEFAULT_PAGE_SIZE) {
		this.#items = items;
		this.pageSize = pageSize;
	}

	get items() {
		return this.#items();
	}
	get pageCount() {
		return Math.max(1, Math.ceil(this.items.length / this.pageSize));
	}
	get currentPage() {
		return Math.min(this.page, this.pageCount - 1);
	}
	get paged(): T[] {
		const start = this.currentPage * this.pageSize;
		return this.items.slice(start, start + this.pageSize);
	}
	get hasPrev() {
		return this.currentPage > 0;
	}
	get hasNext() {
		return this.currentPage < this.pageCount - 1;
	}
	get showControls() {
		return this.items.length > this.pageSize;
	}
	prev = () => {
		this.page = Math.max(0, this.currentPage - 1);
	};
	next = () => {
		this.page = Math.min(this.pageCount - 1, this.currentPage + 1);
	};
}
