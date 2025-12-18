import {
	SphereGeometry,
	Vector3,
} from 'three';
import {
	MeshBVH,
	validateBounds,
} from 'three-mesh-bvh';

describe( 'shiftTriangleOffsets', () => {

	function shiftIndices( geometry, offset ) {

		const index = geometry.index;
		const position = geometry.attributes.position;
		const offset3 = 3 * offset;

		if ( geometry.index ) {

			for ( let i = 0; i < index.count; i ++ ) {

				let i2 = i;
				if ( offset > 0 ) {

					i2 = index.count - i - 1;

				}

				index.setX( i2, index.getX( i2 - offset3 ) );

			}

		} else {

			const vec = new Vector3();
			for ( let i = 0; i < position.count; i ++ ) {

				let i2 = i;
				if ( offset > 0 ) {

					i2 = position.count - i - 1;

				}

				vec.fromBufferAttribute( position, i2 - offset3 );
				position.setXYZ( i2, ...vec );

			}

		}

	}

	describe( 'direct mode', () => {

		it( 'should handle zero offset as no-op', () => {

			const geometry = new SphereGeometry();
			const bvh = new MeshBVH( geometry, { range: { start: 90, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );
			bvh.shiftTriangleOffsets( 0 );

			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should handle positive offset', () => {

			const geometry = new SphereGeometry();
			const bvh = new MeshBVH( geometry, { range: { start: 90, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, 5 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( 5 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should handle negative offset', () => {

			const geometry = new SphereGeometry();
			const bvh = new MeshBVH( geometry, { range: { start: 90, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, - 5 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( - 5 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

	} );

	describe( 'indirect mode', () => {

		it( 'should handle zero offset as no-op', () => {

			const geometry = new SphereGeometry();
			const bvh = new MeshBVH( geometry, { indirect: true, range: { start: 90, count: 90 } } );

			expect( bvh.indirect ).toBe( true );
			expect( validateBounds( bvh ) ).toBe( true );

			bvh.shiftTriangleOffsets( 0 );

			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should handle positive offset', () => {

			const geometry = new SphereGeometry();
			const bvh = new MeshBVH( geometry, { indirect: true, range: { start: 90, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, 5 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( 5 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should handle negative offset', () => {

			const geometry = new SphereGeometry();
			const bvh = new MeshBVH( geometry, { indirect: true, range: { start: 90, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, - 5 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( - 5 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should work when there is no index buffer.', () => {

			const geometry = new SphereGeometry().toNonIndexed();
			const bvh = new MeshBVH( geometry, { indirect: true, range: { start: 90, count: 90 } } );

			expect( geometry.index ).toBe( null );
			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, 5 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( 5 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

	} );

} );
