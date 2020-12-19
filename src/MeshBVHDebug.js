import { Box3, Vector3 } from 'three';
import { arrayToBox } from './Utils/ArrayBoxUtilities.js';
const box1 = new Box3();
const box2 = new Box3();
const vec = new Vector3();

export class MeshBVHDebug {

	constructor( bvh, geometry ) {

		this.bvh = bvh;
		this.geometry = geometry;

	}

	validateBounds() {

		const { bvh, geometry } = this;
		const depthStack = [];
		const index = geometry.index;
		const position = geometry.getAttribute( 'position' );

		bvh.traverse( ( depth, isLeaf, boundingData, offset, count ) => {
			const info = {
				depth,
				isLeaf,
				boundingData,
				offset,
				count,
			};
			depthStack[ depth ] = info;

			arrayToBox( boundingData, box1 );
			const parent = depthStack[ depth - 1 ];

			if ( isLeaf ) {

				// check triangles
				for ( let i = offset * 3, l = ( offset + count ) * 3; i < l; i += 3 ) {

					const i0 = index.getX( i );
					const i1 = index.getX( i + 1 );
					const i2 = index.getX( i + 2 );

					vec.fromBufferAttribute( position, i0 );
					console.assert( box1.containsPoint( vec ), 'Leaf bounds does not fully contain triangle.' );

					vec.fromBufferAttribute( position, i1 );
					console.assert( box1.containsPoint( vec ), 'Leaf bounds does not fully contain triangle.' );

					vec.fromBufferAttribute( position, i2 );
					console.assert( box1.containsPoint( vec ), 'Leaf bounds does not fully contain triangle.' );

				}

			}

			if ( parent ) {

				// check if my bounds fit in my parents
				arrayToBox( boundingData, box2 );
				console.assert( box2.containsBox( box1 ), 'Parent bounds does not fully contain child.' );

			}

		} );

	}

}
