import * as THREE from 'three';
import { arrayToBox } from './Utils/ArrayBoxUtilities.js';

const wiremat = new THREE.LineBasicMaterial( { color: 0x00FF88, transparent: true, opacity: 0.3 } );
const boxGeom = new THREE.Box3Helper().geometry;
let boundingBox = new THREE.Box3();

class MeshBVHRootVisualizer extends THREE.Group {

	constructor( mesh, depth = 10, group = 0 ) {

		super( 'MeshBVHRootVisualizer' );

		this.depth = depth;
		this._oldDepth = - 1;
		this._mesh = mesh;
		this._boundsTree = null;
		this._group = group;

		this.update();

	}

	update() {

		this._oldDepth = this.depth;
		this._boundsTree = this._mesh.geometry.boundsTree;

		let requiredChildren = 0;
		if ( this._boundsTree ) {

			this._boundsTree.traverse( ( depth, isLeaf, boundingData, offsetOrSplit, countOrIsUnfinished ) => {

				let isTerminal = isLeaf || countOrIsUnfinished;

				if ( depth >= this.depth ) return;

				if ( depth === this.depth - 1 || isTerminal ) {

					let m = requiredChildren < this.children.length ? this.children[ requiredChildren ] : null;
					if ( ! m ) {

						m = new THREE.LineSegments( boxGeom, wiremat );
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

class MeshBVHVisualizer extends THREE.Group {

	constructor( mesh, depth = 10 ) {

		super( 'MeshBVHVisualizer' );

		this.depth = depth;
		this._mesh = mesh;
		this._roots = [];

		this.update();

	}

	update() {

		const bvh = this._mesh.geometry.boundsTree;
		const totalRoots = bvh ? bvh._roots.length : 0;
		while ( this._roots.length > totalRoots ) {

			this._roots.pop();

		}

		for ( let i = 0; i < totalRoots; i ++ ) {

			if ( i >= this._roots.length ) {

				const root = new MeshBVHRootVisualizer( this._mesh, this.depth, i );
				this.add( root );
				this._roots.push( root );

			} else {

				let root = this._roots[ i ];
				root.depth = this.depth;
				root.update();

			}

		}

		this.position.copy( this._mesh.position );
		this.rotation.copy( this._mesh.rotation );
		this.scale.copy( this._mesh.scale );

	}

}


export default MeshBVHVisualizer;
