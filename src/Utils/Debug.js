// https://stackoverflow.com/questions/1248302/how-to-get-the-size-of-a-javascript-object
function getPrimitiveSize( el ) {

	switch ( typeof el ) {

		case 'number':
			return 8;
		case 'string':
			return el.length * 2;
		case 'boolean':
			return 4;
		default:
			return 0;

	}

}

function isTypedArray( arr ) {

	const regex = /(Uint|Int|Float)(8|16|32)Array/;
	return regex.test( arr.constructor.name );

}

function getNodeExtremes( node, depth = 0, result = null ) {

	if ( ! result ) {

		result = {
			total: 0,
			depth: {
				min: Infinity, max: - Infinity
			},
			tris: {
				min: Infinity, max: - Infinity
			},
			splits: [ 0, 0, 0 ]
		};

	}

	// we need to check if the node is a leaf and if it has "left" or "right"
	// because we now have a state where it's in an intermediate state during
	// lazy generation.
	result.total ++;
	if ( node.count ) {

		result.depth.min = Math.min( depth, result.depth.min );
		result.depth.max = Math.max( depth, result.depth.max );

		result.tris.min = Math.min( node.count, result.tris.min );
		result.tris.max = Math.max( node.count, result.tris.max );

	} else if ( node.left && node.right ) {

		result.splits[ node.splitAxis ] ++;
		getNodeExtremes( node.left, depth + 1, result );
		getNodeExtremes( node.right, depth + 1, result );

	}

	// If there are no leaf nodes because the tree hasn't finished generating yet.
	if ( result.tris.min === Infinity ) {

		result.tris.min = 0;
		result.tris.max = 0;

	}

	if ( result.depth.min === Infinity ) {

		result.depth.min = 0;
		result.depth.max = 0;

	}

	return result;

}

function getBVHExtremes( bvh ) {

	return bvh._roots.map( root => getNodeExtremes( root ) );

}

function estimateMemoryInBytes( obj ) {

	const traversed = new Set();
	const stack = [ obj ];
	let bytes = 0;

	while ( stack.length ) {

		const curr = stack.pop();
		if ( traversed.has( curr ) ) {

			continue;

		}
		traversed.add( curr );

		for ( let key in curr ) {

			if ( ! curr.hasOwnProperty( key ) ) {

				continue;

			}

			bytes += getPrimitiveSize( key );

			const value = curr[ key ];
			if ( value && ( typeof value === 'object' || typeof value === 'function' ) ) {

				if ( isTypedArray( value ) ) {

					bytes += value.byteLength;

				} else if ( value instanceof ArrayBuffer ) {

					bytes += value.byteLength;

				} else {

					stack.push( value );

				}

			} else {

				bytes += getPrimitiveSize( value );

			}


		}

	}

	return bytes;

}

export { estimateMemoryInBytes, getBVHExtremes };
