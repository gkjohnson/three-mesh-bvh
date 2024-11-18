export class SortedListDesc {

	constructor() {

		this.array = [];

	}

	clear() {

		this.array.length = 0;

	}


	push( node ) {

		const index = this.binarySearch( node.distance );
		this.array.splice( index, 0, node );

	}

	pop() {

		return this.array.pop();

	}

	binarySearch( value ) {

		const array = this.array;

		let low = 0, high = array.length;

		while ( low < high ) {

			const mid = ( low + high ) >>> 1;
			if ( array[ mid ].distance > value ) low = mid + 1;
			else high = mid;

		}

		return low;

	}

}
