import * as THREE from '../node_modules/three/build/three.module.js';

const X_FLAG = 1 << 0;
const Y_FLAG = 1 << 1;
const Z_FLAG = 1 << 2;

const xyzfields = [ 'x', 'y', 'z' ];
const tempvec = new THREE.Vector3();

/* Utilities */
// returns whether or not the provided range is within
// the give min max bounds
const isInside = ( point, range, min, max ) => {

	return point - range > min && point + range < max;

};

const getOctantFlag = ( spPos, radius, centPos, i, width ) => {

	let flags = 0;

	const w2 = width / 2;
	const negmin = centPos - w2;
	const negmax = centPos;

	const posmin = centPos;
	const posmax = centPos + w2;

	// checks if the sphere is within given min max ranges (edges of the bounds)
	const inPos = isInside( spPos, radius, posmin, posmax );
	const inNeg = isInside( spPos, radius, negmin, negmax );

	if ( inPos ) flags |= 1 << i;
	if ( inNeg ) flags |= 1 << ( i + 3 );

	return flags;

};

// asks for where the next octant to place the sphere in within a node
// about "center" with width "width"
const getSphereOctantFlag = ( sphere, center, width ) => {

	// if any of the planes doesn't fully contain the
	// object, then it can't be put in any cell
	const xflags = getOctantFlag( sphere.center.x, sphere.radius, center.x, 0, width );
	if ( xflags === 0 ) return 0;

	const yflags = getOctantFlag( sphere.center.y, sphere.radius, center.y, 1, width );
	if ( yflags === 0 ) return 0;

	const zflags = getOctantFlag( sphere.center.z, sphere.radius, center.z, 2, width );
	if ( zflags === 0 ) return 0;

	return xflags | yflags | zflags;

};

// An octant id is defined by a 3 bit flag (representing xyz). 0 is positive, 1 is negative.
const iterateOverOctants = ( flags, cb ) => {

	for ( let x = 0; x <= 1; x ++ ) {

		const xf = 1 << ( 0 + 3 * x );
		if ( ! ( xf & flags ) ) continue;

		for ( let y = 0; y <= 1; y ++ ) {

			const yf = 1 << ( 1 + 3 * y );
			if ( ! ( yf & flags ) ) continue;

			for ( let z = 0; z <= 1; z ++ ) {

				const zf = 1 << ( 2 + 3 * z );
				if ( ! ( zf & flags ) ) continue;

				let octant = 0;
				if ( x === 0 ) octant |= X_FLAG;
				if ( y === 0 ) octant |= Y_FLAG;
				if ( z === 0 ) octant |= Z_FLAG;

				cb( octant );

			}

		}

	}

};

/* Classes */
export default
class OctreeNode {

	constructor( root, parent = null, octant = - 1 ) {

		// hierarchy context
		this._root = root;
		this._parent = parent;
		this._octant = octant;

		// position
		this._center = new THREE.Vector3();
		this._width = 0;

		// bounds checkers
		this._bounds = new THREE.Box3();
		this._sphere = new THREE.Sphere();

		this._pendingInserts = [];
		this._objects = [];
		this._nodes = new Array( 8 ).fill( null );
		this._octantCount = 0;

		this._sortArray = [[ null, null ], [ null, null ], [ null, null ]];

		if ( parent ) {

			const w2 = parent._width / 4;
			this._width = parent._width / 2;
			this._center.copy( parent._center );
			this._center.x += octant & X_FLAG ? w2 : - w2;
			this._center.y += octant & Y_FLAG ? w2 : - w2;
			this._center.z += octant & Z_FLAG ? w2 : - w2;

		}

		this._updateBounds();

	}

	/* Public API */
	intersectsRay( ray ) {

		// TODO: Is this slow
		return ( ray.intersectsSphere( this._sphere ) || this._sphere.containsPoint( ray.origin ) ) &&
            ( ray.intersectsBox( this._bounds ) || this._bounds.containsPoint( ray.origin ) );

	}

	raycast( raycaster, intersects = [] ) {

		if ( ! this.intersectsRay( raycaster.ray ) ) return;
		this._flushPending();

		const obj = this._objects;
		for ( let i = 0, l = obj.length; i < l; i ++ ) {

			const o = obj[ i ];
			if ( ! this._root._raycastDedupeMap.has( o ) ) {

				this._root._raycastDedupeMap.set( o, o );
				o.raycast( raycaster, intersects );

			}

		}

		if ( this._nodes ) {

			const nodes = this._nodes;
			for ( let i = 0, l = nodes.length; i < l; i ++ ) {

				const n = nodes[ i ];
				if ( n ) {

					n.raycast( raycaster, intersects );

				}

			}

		}

	}

	sphereCast( sphere, intersects = [] ) {

		if (
			! sphere.intersectsSphere( this._sphere )
			&& ! sphere.intersectsBox( this._bounds )
		) {

			return;

		}

		this._flushPending();

		const obj = this._objects;
		for ( let i = 0, l = obj.length; i < l; i ++ ) {

			const o = obj[ i ];
			if ( sphere.intersectsSphere( o.boundingSphere ) ) {

				intersects.push( o );

			}

		}

		for ( let i = 0, l = this._nodes.length; i < l; i ++ ) {

			const n = this._nodes[ i ];
			if ( n !== null ) {

				n.sphereCast( sphere, intersects );

			}

		}

		return intersects;

	}

	// TODO: this is a little slow and should only have to flush
	// pending of something intersects the walls of the frustum
	frustumCast( frustum, intersects = [], encapsulatedOverride = false ) {

		if (
			! frustum.intersectsSphere( this._sphere )
			&& ! frustum.intersectsBox( this._bounds )
		) {

			return;

		}

		let encapsulated = true;
		if ( encapsulatedOverride === false ) {

			for ( let i = 0; i < 6; i ++ ) {

				if ( frustum.planes[ i ].intersectsBox( this._bounds ) ) {

					encapsulated = false;
					break;

				}

			}

		}

		if ( encapsulated === true ) {

			intersects.push( ...this._objects, ...this._pendingInserts );

		} else {

			this._flushPending();

			const obj = this._objects;
			for ( let i = 0, l = obj.length; i < l; i ++ ) {

				const o = obj[ i ];
				if ( frustum.intersectsSphere( o.boundingSphere ) ) {

					intersects.push( o );

				}

			}

		}

		for ( let i = 0, l = this._nodes.length; i < l; i ++ ) {

			const n = this._nodes[ i ];
			if ( n !== null ) {

				n.frustumCast( frustum, intersects, encapsulated );

			}

		}

		return intersects;

	}

	raycastFirst( raycaster ) {

		// TODO: This may need to be updated if there's an overlap
		// percentage involved
		// TODO: This is needed because the plane hit may fall outside
		// of the bounds this current cell, which will cause unnecessary
		// checks. It would be good to cull these out below, instead. This
		// should NEVER cause an early return if the other checks are done
		// correctly
		if ( ! this.intersectsRay( raycaster.ray ) ) return;
		this._flushPending();

		raycaster.firstHitOnly = true;
		let closest = raycaster.intersectObjects( this._objects, false, null, true ).shift();

		if ( this._nodes ) {

			// get the starting octant
			const nodes = this._nodes;
			const sortarr = this._sortArray;
			const ray = raycaster.ray;
			const relStart = tempvec.copy( ray.origin ).sub( this._center );

			const rayDir = ray.direction;
			let octant =
				( relStart.x < 0 ? 0 : X_FLAG ) |
				( relStart.y < 0 ? 0 : Y_FLAG ) |
				( relStart.z < 0 ? 0 : Z_FLAG );

			sortarr.forEach( ( v, i ) => {

				// get the number of steps on this axis until we reach the
				// dividing plane
				const xyz = xyzfields[ i ];
				const steps = relStart[ xyz ] / - rayDir[ xyz ];

				if ( steps >= 0 ) {

					v[ 0 ] = steps;

				} else {

					v[ 0 ] = Infinity;

				}

				v[ 1 ] = 1 << i;

			} );
			sortarr.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );

			let i = 0;
			do {

				const n = nodes[ octant ];
				if ( n !== null ) {

					const res = nodes[ octant ].raycastFirst( raycaster );
					if ( res && ( ! closest || res.distance < closest.distance ) ) {

						closest = res;
						break;

					}

				}

				if ( i == 3 || sortarr[ i ][ 0 ] === Infinity ) break;

				octant ^= sortarr[ i ][ 1 ];
				i ++;

			} while ( true );

		}

		// TODO: It's possible that this hit is further past the
		// end of the raycast
		return closest;

	}

	/* Private API */
	_updateBounds() {

		const w2 = this._width / 2;
		tempvec.set( w2, w2, w2 );

		// Set up box
		this._bounds.min.copy( this._center ).sub( tempvec );
		this._bounds.max.copy( this._center ).add( tempvec );

		// Set up sphere
		const len = tempvec.length();
		this._sphere.radius = len;
		this._bounds.getCenter( this._sphere.center );

	}

	_search( sphere, cb ) {

		cb( this );

		if ( this._nodes ) {

			const flags = getSphereOctantFlag( sphere, this._center, this._width );

			iterateOverOctants( flags, octant => {

				const n = this._nodes && this._nodes[ octant ];
				if ( n ) n._search( sphere, cb );

			} );

		}

	}

	_flushPending() {

		for ( let i = 0, l = this._pendingInserts.length; i < l; i ++ ) {

			const o = this._pendingInserts[ i ];
			const flags = getSphereOctantFlag( o.boundingSphere, this._center, this._width );

			if ( flags === 0 ) {

				this._objects.push( o );

			} else {

				// find the node it belongs in.
				iterateOverOctants( flags, octant => {

					let n = this._getOctant( octant );
					n._addPending( o );

				} );

			}

		}

		this._pendingInserts.length = 0;

	}

	_addPending( o ) {

		if ( ! o.boundingSphere ) throw new Error( 'Object has no boundingSphere', o );

		// insert into appropriate children
		if ( this._octantCount === 0 ) {

			this._objects.push( o );

			if ( this._objects.length >= this._root._maxObjects ) {

				this._pendingInserts.push( ...this._objects );
				this._objects.length = 0;

			}

		} else {

			this._pendingInserts.push( o );

		}

	}

	_remove( o ) {

		const pindex = this._pendingInserts.indexOf( o );
		const oindex = this._objects.indexOf( o );

		if ( pindex !== - 1 ) {

			this._pendingInserts.splice( pindex, 1 );

		}

		if ( oindex !== - 1 ) {

			this._objects.splice( oindex, 1 );

		}

		this._tryDispose();

	}

	_removeOctant( octant ) {

		this._nodes[ octant ] = null;
		this._octantCount --;

		if ( this._octantCount === 0 ) {

			this._tryDispose();

		}

	}

	_getOctant( octant ) {

		const n = this._nodes && this._nodes[ octant ];

		if ( ! n ) {

			this._nodes[ octant ] = new OctreeNode( this._root, this, octant );
			this._octantCount ++;
			return this._nodes[ octant ];

		} else {

			return n;

		}

	}

	_tryDispose() {

		if ( this._parent !== null && this._objects.length === 0 && this._pendingInserts.length === 0 && this._octantCount === 0 ) {

			this._parent._removeOctant( this._octant );

		}

	}

}
