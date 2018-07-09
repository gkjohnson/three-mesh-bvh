import * as THREE from '../node_modules/three/build/three.module.js';
import OctreeNode from './OctreeNode.js';
// https://geidav.wordpress.com/2014/07/18/advanced-octrees-1-preliminaries-insertion-strategies-and-max-tree-depth/

const X_FLAG = 1 << 0;
const Y_FLAG = 1 << 1;
const Z_FLAG = 1 << 2;

// TODO
// - Create a callback Object3D that can be used to keep the tree in sync
// - Create a frustum-culled demo
// - Update the raycast api so it doesn't automatically set the `firstHitOnly` flag
// - Add margin for splitting objects into multiple nodes
// - Max depth is needed in case there are a bunch of objects right on top of eachother
// - Create a general intersection mechanism for colliding objects ( and meshes ) more easily!

export default
class Octree {

	constructor( width = 64, maxObjects = 6 ) {

		this.root = new OctreeNode( this, null, 0 );
		this.root._width = width;
		this.root._updateBounds();

		this._maxObjects = maxObjects;

		// Store references from obj => prevous sphere
		// so we can dirty check it
		this._objectMap = new Map();

		this._objectActionMap = new Map();
		this._objectActionArr = [];
		this._raycastDedupeMap = new Map();

	}

	/* Raycasting */
	raycast( raycaster, intersects = [] ) {

		this._runObjectActions();

		this._raycastDedupeMap.clear();
		this.root.raycast( raycaster, intersects );
		intersects.sort( ( a, b ) => a.distance - b.distance );

		return intersects;

	}

	raycastFirst( ...args ) {

		this._runObjectActions();
		return this.root.raycastFirst( ...args );

	}

	frustumCast( ...args ) {

		this._runObjectActions();

		return this.root.frustumCast( ...args );

	}

	sphereCast( ...args ) {

		this._runObjectActions();
		return this.root.sphereCast( ...args );

	}

	/* Object Updates */
	add( o ) {

		this._addObjectAction( o, 'add' );

	}

	update( o ) {

		this._addObjectAction( o, 'update' );

	}

	remove( o ) {

		this._addObjectAction( o, 'remove' );

	}

	/* Jobs */
	_addObjectAction( object, action ) {

		let prevAction = this._objectActionMap.get( object );
		if ( ! prevAction ) {

			const alreadyAdded = this._objectMap.get( object );
			if ( alreadyAdded || ! alreadyAdded && action === 'add' ) {

				this._objectActionMap.set( object, action );

			}

		} else if ( prevAction === 'add' && action === 'remove' ) {

			this._objectActionMap.delete( object );

		}

	}

	_runAction( o, ac ) {

		const add = o => {

			const sp = o.boundingSphere.clone();
			this._objectMap.set( o, sp );
			this._addAndTryGrow( o, sp );

		};

		const remove = o => {

			const sp = this._objectMap.get( o );

			// TODO: This is pretty slow at the moment
			this.root._search( sp, n => n._remove( o ) );
			this._objectMap.delete( o );
			this._tryShrink();

		};

		const update = o => {

			const sp = this._objectMap.get( o );
			if ( sp.equals( o.boundingSphere ) ) return;

			remove( o );

			// TODO: We need to see if the bounding sphere is _outside_ the current
			// root and expand if it is. In add, too
			add( o );

		};

		if ( ac === 'add' ) add( o );
		if ( ac === 'remove' ) remove( o );
		if ( ac === 'update' ) update( o );

	}

	_runObjectActions() {

		this._objectActionMap.forEach( ( ac, o ) => this._runAction( o, ac ) );
		this._objectActionMap.clear();

	}

	/* Root Grow and Shrink */
	_addAndTryGrow( o, sp ) {

		const box = sp.getBoundingBox( new THREE.Box3() );

		if ( ! this.root._bounds.containsBox( box ) ) {

			// Try to grow back towards zero
			const growDir = this.root._center.clone().multiplyScalar( - 1 );
			growDir.x = Math.sign( growDir.x ) || 1;
			growDir.y = Math.sign( growDir.y ) || 1;
			growDir.z = Math.sign( growDir.z ) || 1;

			const octant =
				( growDir.x < 0 ? X_FLAG : 0 ) |
				( growDir.y < 0 ? Y_FLAG : 0 ) |
				( growDir.z < 0 ? Z_FLAG : 0 );

			growDir.multiplyScalar( this.root._width / 2 ).add( this.root._center );

			const oldRoot = this.root;

			this.root = new OctreeNode( this );
			this.root._width = oldRoot._width * 2;
			this.root._center.copy( growDir );
			this.root._updateBounds();

			// TODO: If the original root is empty it could
			// just be repurposed to fit the first object
			if (
				oldRoot._octantCount > 0
				|| oldRoot._objects.length > 0
				|| oldRoot._pendingInserts.length > 0
			) {

				this.root._nodes[ octant ] = oldRoot;
				this.root._octantCount ++;
				oldRoot._octant = octant;
				oldRoot._parent = this.root;

			}

			this._addAndTryGrow( o, sp );

		} else {

			this.root._addPending( o );

		}

	}

	_tryShrink() {

		// TODO: This shrink can happen once the pending inserts
		// have been inserted, potentially leaving the root with no
		// children
		if (
			this.root._objects.length === 0
			&& this.root._pendingInserts.length === 0
			&& this.root._octantCount === 1
		) {

			this.root = this.root._nodes.reduce( ( acc, n ) => acc || n );
			this.root._parent = null;
			this.root._octant = - 1;

			this._tryShrink();

		}

	}

}
