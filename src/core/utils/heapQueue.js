import { MinHeap } from "./minHeap";

export class HeapQueue {

	constructor() {

		this.pool = [];
		this.count = 0;

	}

	getMinHeap() {

		const pool = this.pool;
		const count = this.count;

		if ( count >= pool.length ) {

			const item = new MinHeap();
			pool.push( item );
			this.count ++;
			return item;

		}

		const item = pool[ count ];
		this.count ++;
		item.clear();
		return item;

	}

	reset() {

		this.count = 0;

	}

}
