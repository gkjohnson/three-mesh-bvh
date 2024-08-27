export class SortedListDesc {

	constructor() {

		this.array = [];

	}

	clear() {

		this.array = [];

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

		let start = 0;
		let end = array.length - 1;
		let index = 0;

		while ( start <= end ) {

			index = Math.ceil( ( start + end ) / 2 );

			if ( index === 0 ) break;
			if ( array[ index ].distance <= value && array[ index - 1 ].distance >= value ) return index;

			if ( value > array[ index ].distance ) end = index - 1;
			else start = index + 1;

		}

		return value < array[ index ]?.distance ? index + 1 : index;

	}

}
