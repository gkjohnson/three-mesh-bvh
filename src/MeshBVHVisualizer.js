import { LineBasicMaterial, BufferAttribute, Box3, Group, LineSegments } from 'three';
import { arrayToBox } from './Utils/ArrayBoxUtilities.js';

const boundingBox = new Box3();
class MeshBVHRootVisualizer extends Group {

	constructor( mesh, material, depth = 10, group = 0 ) {

		super( 'MeshBVHRootVisualizer' );

		const lines = new LineSegments( undefined, material );
		lines.raycast = () => {};

		this.depth = depth;
		this.mesh = mesh;
		this._lines = lines;
		this._group = group;

		this.add( lines );
		this.update();

	}

	update() {

		const lines = this._lines;
		const linesGeometry = lines.geometry;
		const boundsTree = this.mesh.geometry.boundsTree;
		linesGeometry.dispose();
		lines.visible = false;
		if ( boundsTree ) {

			// count the number of bounds required
			const targetDepth = this.depth - 1;
			let boundsCount = 0;
			boundsTree.traverse( ( depth, isLeaf ) => {

				if ( depth === targetDepth || isLeaf ) {

					boundsCount ++;
					return true;

				}

			} );

			// fill in the position buffer with the bounds corners
			let posIndex = 0;
			const positionArray = new Float32Array( 8 * 3 * boundsCount );
			boundsTree.traverse( ( depth, isLeaf, boundingData ) => {

				if ( depth === targetDepth || isLeaf ) {

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

					return true;

				}

			} );

			// fill in the index buffer to point to the corner points
			const edgeIndices = new Uint8Array( [
				0, 4,
				1, 5,
				2, 6,
				3, 7,

				0, 2,
				1, 3,
				4, 6,
				5, 7,

				0, 1,
				2, 3,
				4, 5,
				6, 7,
			] );

			let indexArray;
			if ( positionArray.length > 65535 ) {

				indexArray = new Uint32Array( 12 * 2 * boundsCount );

			} else {

				indexArray = new Uint16Array( 12 * 2 * boundsCount );

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
			lines.visible = true;

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

		super( 'MeshBVHVisualizer' );

		this.depth = depth;
		this.mesh = mesh;
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

			} else {

				let root = this._roots[ i ];
				root.depth = this.depth;
				root.mesh = this.mesh;
				root.update();

			}

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
