import * as THREE from '../node_modules/three/build/three.module.js';

const cube = new THREE.CubeGeometry( 1, 1, 1 );
const wiremat = new THREE.LineBasicMaterial( { color: 0x00FF88, wireframe: true, wireframeLinewidth: 1, transparent: true, opacity: 0.5 } );
const boxGeom = new THREE.Box3Helper().geometry;

export default
class OctreeVisualizer extends THREE.Object3D {

	constructor( octree, depth = 10 ) {

		super();

		this.depth = depth;
		this._octree = octree;

		this.update();

	}

	update() {

		let requiredChildren = 0;

		if ( this._octree ) {

			const recurse = ( n, d ) => {

				if ( d === this.depth ) return;

				let m = requiredChildren < this.children.length ? this.children[ requiredChildren ] : null;
				if ( ! m ) {

					m = new THREE.LineSegments( boxGeom, wiremat );
					m.raycast = () => [];
					this.add( m );

				}
				requiredChildren ++;

				m.position.copy( n._center );
				m.scale.set( 1, 1, 1 ).multiplyScalar( n._width ).multiplyScalar( 0.5 );

				if ( n._nodes ) n._nodes.forEach( n => n && recurse( n, d + 1 ) );

			};

			recurse( this._octree.root, 0 );

		}

		while ( this.children.length > requiredChildren ) this.remove( this.children.pop() );

	}

}
