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
			depth: {
				min: Infinity, max: - Infinity
			},
			tris: {
				min: Infinity, max: - Infinity
			},
			splits: [ 0, 0, 0 ]
		};

	}

	if ( ! node.left && ! node.right ) {

		result.depth.min = Math.min( depth, result.depth.min );
		result.depth.max = Math.max( depth, result.depth.max );

		result.tris.min = Math.min( node.count, result.tris.min );
		result.tris.max = Math.max( node.count, result.tris.max );

	} else {

		result.splits[ node.splitAxis ] ++;
		getNodeExtremes( node.left, depth + 1, result );
		getNodeExtremes( node.right, depth + 1, result );

	}

	return result;

}

function getBVHExtremes( bvh ) {

	return bvh._roots.map( root => getNodeExtremes( root ) );

}

function estimateMemoryInBytes( obj ) {

	const traversed = [ ];
	const stack = [ obj ];
	let bytes = 0;

	while ( stack.length ) {

		const curr = stack.pop();
		if ( traversed.includes( curr ) ) continue;
		traversed.push( curr );

		for ( let key in curr ) {

			if ( ! curr.hasOwnProperty( key ) ) continue;

			bytes += getPrimitiveSize( key );

			const value = curr[ key ];
			if ( value && ( typeof value === 'object' || typeof value === 'function' ) ) {

				if ( isTypedArray( value ) ) {

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
