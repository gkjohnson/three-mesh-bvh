import { LineBasicMaterial, BufferAttribute, Box3, Group, LineSegments } from 'three';
import { arrayToBox } from './Utils/ArrayBoxUtilities.js';

// fill in the index buffer to point to the corner points
const edgeIndices = new Uint8Array( [
	// x axis
	0, 4,
	1, 5,
	2, 6,
	3, 7,

	// y axis
	0, 2,
	1, 3,
	4, 6,
	5, 7,

	// z axis
	0, 1,
	2, 3,
	4, 5,
	6, 7,
] );

const faceIndices = new Uint8Array( [
	0, 1, 3,
	3, 1, 2,

	1, 5, 2,
	2, 5, 6,

	5, 4, 6,
	6, 4, 7,

	4, 0, 7,
	7, 0, 3,

	3, 2, 7,
	7, 2, 6,

	4, 5, 0,
	0, 5, 1
] );


const boundingBox = new Box3();
class MeshBVHRootVisualizer extends LineSegments {

	constructor( mesh, material, depth = 10, group = 0 ) {

		super( undefined, material );

		this.material = material;
		this.name = 'MeshBVHRootVisualizer';
		this.depth = depth;
		this.displayParents = false;
		this.mesh = mesh;
		this.displayLines = true;
		this._group = group;

	}

	raycast() {}

	update() {

		const linesGeometry = this.geometry;
		const boundsTree = this.mesh.geometry.boundsTree;
		const group = this._group;
		linesGeometry.dispose();
		this.visible = false;
		if ( boundsTree ) {

			// count the number of bounds required
			const targetDepth = this.depth - 1;
			const displayParents = this.displayParents;
			let boundsCount = 0;
			boundsTree.traverse( ( depth, isLeaf ) => {

				if ( depth === targetDepth || isLeaf ) {

					boundsCount ++;
					return true;

				} else if ( displayParents ) {

					boundsCount ++;

				}

			}, group );

			// fill in the position buffer with the bounds corners
			let posIndex = 0;
			const positionArray = new Float32Array( 8 * 3 * boundsCount );
			boundsTree.traverse( ( depth, isLeaf, boundingData ) => {

				const terminate = depth === targetDepth || isLeaf;
				if ( terminate || displayParents ) {

					arrayToBox( boundingData, boundingBox );

					const { min, max } = boundingBox;
					for ( let x = - 1; x <= 1; x += 2 ) {

						const xVal = x < 0 ? min.x : max.x;
						for ( let y = - 1; y <= 1; y += 2 ) {

							const yVal = y < 0 ? min.y : max.y;
							for ( let z = - 1; z <= 1; z += 2 ) {

								const zVal = z < 0 ? min.z : max.z;
								positionArray[ posIndex + 0 ] = xVal;
								positionArray[ posIndex + 1 ] = yVal;
								positionArray[ posIndex + 2 ] = zVal;

								posIndex += 3;

							}

						}

					}

					return terminate;

				}

			}, group );



			let indexArray;
			const indexCount = edgeIndices.lengths;
			if ( positionArray.length > 65535 ) {

				indexArray = new Uint32Array( indexCount * boundsCount );

			} else {

				indexArray = new Uint16Array( indexCount * boundsCount );

			}

			for ( let i = 0; i < boundsCount; i ++ ) {

				const posOffset = i * 8;
				const indexOffset = i * 24;
				for ( let j = 0; j < 24; j ++ ) {

					indexArray[ indexOffset + j ] = posOffset + edgeIndices[ j ];

				}

			}

			// update the geometry
			linesGeometry.setIndex(
				new BufferAttribute( indexArray, 1, false ),
			);
			linesGeometry.setAttribute(
				'position',
				new BufferAttribute( positionArray, 3, false ),
			);
			this.visible = true;

		}

	}

}

class MeshBVHVisualizer extends Group {

	get color() {

		return this._material.color;

	}

	get opacity() {

		return this._material.opacity;

	}

	set opacity( v ) {

		this._material.opacity = v;

	}

	constructor( mesh, depth = 10 ) {

		super();

		this.name = 'MeshBVHVisualizer';
		this.depth = depth;
		this.mesh = mesh;
		this.displayParents = false;
		this._roots = [];
		this._material = new LineBasicMaterial( {
			color: 0x00FF88,
			transparent: true,
			opacity: 0.3,
			depthWrite: false,
		} );

		this.update();

	}

	update() {

		const bvh = this.mesh.geometry.boundsTree;
		const totalRoots = bvh ? bvh._roots.length : 0;
		while ( this._roots.length > totalRoots ) {

			this._roots.pop();

		}

		for ( let i = 0; i < totalRoots; i ++ ) {

			if ( i >= this._roots.length ) {

				const root = new MeshBVHRootVisualizer( this.mesh, this._material, this.depth, i );
				this.add( root );
				this._roots.push( root );

			}

			const root = this._roots[ i ];
			root.depth = this.depth;
			root.mesh = this.mesh;
			root.displayParents = this.displayParents;
			root.update();

		}

	}

	updateMatrixWorld( ...args ) {

		this.position.copy( this.mesh.position );
		this.rotation.copy( this.mesh.rotation );
		this.scale.copy( this.mesh.scale );

		super.updateMatrixWorld( ...args );

	}

	copy( source ) {

		this.depth = source.depth;
		this.mesh = source.mesh;

	}

	clone() {

		return new MeshBVHVisualizer( this.mesh, this.depth );

	}

	dispose() {

		this._material.dispose();

	}

}


export default MeshBVHVisualizer;
