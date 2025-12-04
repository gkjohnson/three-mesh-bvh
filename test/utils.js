import { AVERAGE, CENTER, getBVHExtremes, SAH } from 'three-mesh-bvh';
import { Vector3, Quaternion, Euler } from 'three';

// https://stackoverflow.com/questions/3062746/special-simple-random-number-generator
let _seed = null;
export function setSeed( seed ) {

	_seed = seed;

}

export function random() {

	if ( _seed === null ) throw new Error();

	const a = 1103515245;
	const c = 12345;
	const m = 2e31;

	_seed = ( a * _seed + c ) % m;
	return _seed / m;

}

// Returns the max tree depth of the BVH
export function getMaxDepth( bvh ) {

	return getBVHExtremes( bvh )[ 0 ].depth.max;

}

export function setRandomVector( vector, length ) {

	vector
		.set(
			Math.random() - 0.5,
			Math.random() - 0.5,
			Math.random() - 0.5
		)
		.normalize()
		.multiplyScalar( length );

	return vector;

}

export function getRandomOrientation( matrix, range ) {

	const pos = new Vector3();
	const quat = new Quaternion();
	const sca = new Vector3( 1, 1, 1 );

	setRandomVector( pos, range );
	quat.setFromEuler( new Euler( Math.random() * 180, Math.random() * 180, Math.random() * 180 ) );
	matrix.compose( pos, quat, sca );
	return matrix;

}

export function runTestMatrix( optionsMatrix = {}, cb ) {

	// Import strategy constants lazily to avoid circular dependencies
	// These will be available when the test actually runs
	const options = {
		strategy: [ CENTER, SAH, AVERAGE ],
		indirect: [ false, true ],
		useSharedArrayBuffer: [ false ],
		setBoundingBox: [ true ],
		maxLeafTris: [ 10 ],
		maxDepth: [ 40 ],
		...optionsMatrix,
	};

	traverse( Object.keys( options ) );

	function traverse( remainingKeys, state = {} ) {

		const description = Object
			.entries( state )
			.map( ( [ key, value ] ) => `${ key }: ${ value }` )
			.join( ', ' );

		if ( remainingKeys.length === 0 ) {

			cb( description, { ...state } );
			return;

		}

		let values;
		const key = remainingKeys.pop();
		if ( Array.isArray( options[ key ] ) ) {

			values = options[ key ];

		} else {

			values = [ options[ key ] ];

		}

		for ( let i = 0, l = values.length; i < l; i ++ ) {

			const value = values[ i ];
			const newState = { ...state, [ key ]: value };
			traverse( [ ...remainingKeys ], newState );

		}

	}

}
