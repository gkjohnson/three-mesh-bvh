import {
	BoxGeometry,
	Vector3,
} from 'three';
import {
	MeshBVH,
	validateBounds,
} from 'three-mesh-bvh';

describe( 'shiftTriangleOffsets', () => {

	function shiftIndices( geometry, triangleOffset ) {

		const index = geometry.index;
		const position = geometry.attributes.position;

		if ( geometry.index ) {

			for ( let i = 0; i < index.count; i ++ ) {

				let i2 = i;
				if ( triangleOffset > 0 ) {

					i2 = index.count - i - 1;

				}

				index.setX( i2, index.getX( i2 - triangleOffset * 3 ) );

			}

		} else {

			const vec = new Vector3();
			for ( let i = 0; i < position.count; i ++ ) {

				let i2 = i;
				if ( triangleOffset > 0 ) {

					i2 = position.count - i - 1;

				}

				vec.fromBufferAttribute( position, i2 - triangleOffset * 3 );
				position.setXYZ( i2, ...vec );

			}

		}

	}

	describe( 'direct mode', () => {

		it( 'should handle zero offset as no-op', () => {

			const geometry = new BoxGeometry( 1, 1, 1 );
			const bvh = new MeshBVH( geometry, { range: { start: 15, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );
			bvh.shiftTriangleOffsets( 0 );

			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should handle positive offset', () => {

			const geometry = new BoxGeometry( 1, 1, 1 );
			const bvh = new MeshBVH( geometry, { range: { start: 15, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, 5 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( 5 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should handle negative offset', () => {

			const geometry = new BoxGeometry( 1, 1, 1 );
			const bvh = new MeshBVH( geometry, { range: { start: 15, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, - 2 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( - 2 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

	} );

	describe( 'indirect mode', () => {

		it( 'should handle zero offset as no-op', () => {

			const geometry = new BoxGeometry( 1, 1, 1 );
			const bvh = new MeshBVH( geometry, { indirect: true, range: { start: 15, count: 90 } } );

			expect( bvh.indirect ).toBe( true );
			expect( validateBounds( bvh ) ).toBe( true );

			bvh.shiftTriangleOffsets( 0 );

			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should handle positive offset', () => {

			const geometry = new BoxGeometry( 1, 1, 1 );
			const bvh = new MeshBVH( geometry, { indirect: true, range: { start: 15, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, 3 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( 3 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

		it( 'should handle negative offset', () => {

			const geometry = new BoxGeometry( 1, 1, 1 );
			const bvh = new MeshBVH( geometry, { indirect: true, range: { start: 15, count: 90 } } );

			expect( validateBounds( bvh ) ).toBe( true );

			shiftIndices( geometry, - 1 );
			expect( validateBounds( bvh ) ).toBe( false );

			bvh.shiftTriangleOffsets( - 1 );
			expect( validateBounds( bvh ) ).toBe( true );

		} );

	} );

} );
