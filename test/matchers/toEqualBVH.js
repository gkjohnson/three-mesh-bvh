import { expect } from 'vitest';
import { MeshBVH } from '../../src/index.js';

expect.extend( {
	toEqualBVH( received, expected ) {

		const serializedReceived = MeshBVH.serialize( received );
		const serializedExpected = MeshBVH.serialize( expected );
		const { isNot } = this;

		let pass = true;
		try {

			/* eslint-disable @vitest/no-standalone-expect */
			const expectedRoots = serializedExpected.roots.map( r => Array.from( r ) );
			const receivedRoots = serializedReceived.roots.map( r => Array.from( r ) );
			expect( expectedRoots ).toEqual( receivedRoots );
			expect( Array.from( serializedExpected.index ) ).toEqual( Array.from( serializedReceived.index ) );
			expect( Array.from( serializedExpected.indirectBuffer || [] ) ).toEqual( Array.from( serializedReceived.indirectBuffer || [] ) );
			/* eslint-enabled @vitest/no-standalone-expect */

		} catch ( error ) {

			console.log( error.message )
			pass = false;

		}

		return {
			pass,
			message: () => {

				if ( isNot ) {

					return 'expected BVHs not to be equal';

				}

				return 'expected BVHs to be equal';

			},
		};

	},
} );
