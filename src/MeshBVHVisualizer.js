import { LineBasicMaterial, BufferAttribute, Box3, Group, LineSegments } from 'three';
import { arrayToBox } from './Utils/ArrayBoxUtilities.js';

const boundingBox = new Box3();
const keys = [ 'x', 'y', 'z' ];
class MeshBVHRootVisualizer extends Group {

	constructor( mesh, material, depth = 10, group = 0 ) {

		super( 'MeshBVHRootVisualizer' );

		const lines = new LineSegments( undefined, material );
		this.add( lines );

		this.depth = depth;
		this.mesh = mesh;
		this._lines = lines;
		this._group = group;

		this.update();

	}

	update() {

		const lines = this._lines;
		const linesGeometry = lines.geometry;
		const boundsTree = this.mesh.geometry.boundsTree;
		linesGeometry.dispose();
		lines.visible = false;
		if ( boundsTree ) {

			const targetDepth = this.depth - 1;
			let boundsCount = 0;
			boundsTree.traverse( ( depth, isLeaf ) => {

				if ( depth === targetDepth || isLeaf ) {

					boundsCount ++;
					return true;

				}

			} );

			let index = 0;
			const newPosition = new Float32Array( 12 * 6 * boundsCount );
			boundsTree.traverse( ( depth, isLeaf, boundingData ) => {

				if ( depth === targetDepth || isLeaf ) {

					arrayToBox( boundingData, boundingBox );

					const { min, max } = boundingBox;
					for ( let k = 0; k < 3; k ++ ) {

						const index0 = k;
						const index1 = ( k + 1 ) % 3;
						const index2 = ( k + 2 ) % 3;
						const key0 = keys[ k ];
						const key1 = keys[ index1 ];
						const key2 = keys[ index2 ];

						const v0Pos = max[ key0 ];
						const v0Neg = min[ key0 ];
						for ( let i = - 1; i <= 1; i += 2 ) {

							const v1 = i < 0 ? min[ key1 ] : max[ key1 ];
							for ( let j = - 1; j <= 1; j += 2 ) {

								const v2 = j < 0 ? min[ key2 ] : max[ key2 ];

								newPosition[ index + index0 ] = v0Neg;
								newPosition[ index + index1 ] = v1;
								newPosition[ index + index2 ] = v2;
								index += 3;

								newPosition[ index + index0 ] = v0Pos;
								newPosition[ index + index1 ] = v1;
								newPosition[ index + index2 ] = v2;
								index += 3;

							}

						}

					}

					return true;

				}

			} );

			linesGeometry.setAttribute(
				'position',
				new BufferAttribute( newPosition, 3, false ),
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
