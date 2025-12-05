/**
 * @reference https://github.com/zrwusa/data-structure-typed/blob/main/src/data-structures/heap/heap.ts
 */
export class MinHeap {

	constructor() {

		this.maxSize = 8; // we should find a good default size
		this._elements = [];

	}

	add( element ) {

		this._elements.push( element );
		this._bubbleUp( this._elements.length - 1 );

	}

	isFull() {

		return this._elements.length >= this.maxSize;

	}

	poll() {

		const elements = this._elements;
		if ( elements.length === 0 ) return;
		const value = elements[ 0 ];
		const last = elements.pop();
		if ( elements.length ) {

			elements[ 0 ] = last;
			this._sinkDown( 0, elements.length >> 1 );

		}

		return value;

	}

	clear() {

		this._elements.length = 0;

	}

	_bubbleUp( index ) {

		const elements = this._elements;
		const element = elements[ index ];
		while ( index > 0 ) {

			const parent = ( index - 1 ) >> 1;
			const parentItem = elements[ parent ];
			if ( parentItem.distance <= element.distance ) break;
			elements[ index ] = parentItem;
			index = parent;

		}

		elements[ index ] = element;

	}

	_sinkDown( index, halfLength ) {

		const elements = this._elements;
		const element = elements[ index ];
		while ( index < halfLength ) {

			let left = ( index << 1 ) | 1;
			const right = left + 1;
			let minItem = elements[ left ];
			if ( right < elements.length && minItem.distance > elements[ right ].distance ) {

				left = right;
				minItem = elements[ right ];

			}

			if ( minItem.distance >= element.distance ) break;
			elements[ index ] = minItem;
			index = left;

		}

		elements[ index ] = element;

	}

}
