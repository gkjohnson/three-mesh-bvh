import { LineBasicMaterial, Box3Helper, Box3, Group, LineSegments } from 'three';
import { arrayToBox } from './Utils/ArrayBoxUtilities.js';

const wiremat = new LineBasicMaterial( { color: 0x00FF88, transparent: true, opacity: 0.3 } );
const boxGeom = new Box3Helper().geometry;
let boundingBox = new Box3();

class MeshBVHRootVisualizer extends Group {

	constructor( mesh, depth = 10, group = 0 ) {

		super( 'MeshBVHRootVisualizer' );

		this.depth = depth;
		this.mesh = mesh;
		this._group = group;

		this.update();

	}

	update() {

		const boundsTree = this.mesh.geometry.boundsTree;
		let requiredChildren = 0;
		if ( boundsTree ) {

			boundsTree.traverse( ( depth, isLeaf, boundingData, offsetOrSplit, countOrIsUnfinished ) => {

				let isTerminal = isLeaf || countOrIsUnfinished;

				// Stop traversal
				if ( depth >= this.depth ) {

					return true;

				}

				if ( depth === this.depth - 1 || isTerminal ) {

					let m = requiredChildren < this.children.length ? this.children[ requiredChildren ] : null;
					if ( ! m ) {

						m = new LineSegments( boxGeom, wiremat );
						m.raycast = () => [];
						this.add( m );

					}

					requiredChildren ++;
					arrayToBox( boundingData, boundingBox );
					boundingBox.getCenter( m.position );
					m.scale.subVectors( boundingBox.max, boundingBox.min ).multiplyScalar( 0.5 );

					if ( m.scale.x === 0 ) m.scale.x = Number.EPSILON;
					if ( m.scale.y === 0 ) m.scale.y = Number.EPSILON;
					if ( m.scale.z === 0 ) m.scale.z = Number.EPSILON;

				}

			} );

		}

		while ( this.children.length > requiredChildren ) this.remove( this.children.pop() );

	}

}

class MeshBVHVisualizer extends Group {

	constructor( mesh, depth = 10 ) {

		super( 'MeshBVHVisualizer' );

		this.depth = depth;
		this.mesh = mesh;
		this._roots = [];

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

				const root = new MeshBVHRootVisualizer( this.mesh, this.depth, i );
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

}


export default MeshBVHVisualizer;
