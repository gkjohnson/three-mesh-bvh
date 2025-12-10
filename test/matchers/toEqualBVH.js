import { expect } from 'vitest';
import { MeshBVH } from 'three-mesh-bvh';

expect.extend( {
	toEqualBVH( received, expected ) {

		const serializedReceived = MeshBVH.serialize( received );
		const serializedExpected = MeshBVH.serialize( expected );
		const { isNot } = this;

		let pass = true;
		try {

			// deep equal cannot be tested with array buffers
			const expectedRoots = serializedExpected.roots.map( r => new Uint8Array( r ) );
			const receivedRoots = serializedReceived.roots.map( r => new Uint8Array( r ) );
			expect( expectedRoots ).toEqual( receivedRoots );
			expect( serializedExpected.index ).toEqual( serializedReceived.index );
			expect( serializedExpected.indirectBuffer ).toEqual( serializedReceived.indirectBuffer );

			// ensure we're not using array buffers anywhere else
			expect( serializedExpected.index instanceof ArrayBuffer ).not.toBeTruthy();
			expect( serializedReceived.index instanceof ArrayBuffer ).not.toBeTruthy();
			expect( serializedExpected.indirectBuffer instanceof ArrayBuffer ).not.toBeTruthy();
			expect( serializedReceived.indirectBuffer instanceof ArrayBuffer ).not.toBeTruthy();

		} catch ( error ) {

			console.log( error.message );
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
