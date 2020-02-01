import * as THREE from 'three';
import MeshBVHNode from './MeshBVHNode.js';
import BVHConstructionContext from './BVHConstructionContext.js';
import { arrayToBox, boxToArray } from './Utils/ArrayBoxUtilities.js';
import { CENTER } from './Constants.js';
import {
	intersectRay,
	raycast,
	raycastFirst,
	shapecast,
	intersectsGeometry,
	intersectsBox,
	intersectsSphere,
	closestPointToPoint,
	closestPointToGeometry,
} from './castFunctions.js';

// boundingData  		: 6 float32
// left / offset 		: 1 uint32
// right / count 		: 1 uint32
// splitAxis / isLeaf 	: 1 uint32
const BYTES_PER_NODE = 6 * 4 + 4 + 4 + 4;
const IS_LEAFNODE_FLAG = 0xFFFFFFFF;
const SKIP_GENERATION = Symbol( 'skip tree generation' );

export default class MeshBVH {

	static serialize( bvh, geometry, copyIndexBuffer = true ) {

		function countNodes( node ) {

			if ( node.count ) {

				return 1;

			} else {

				return 1 + countNodes( node.left ) + countNodes( node.right );

			}

		}

		function populateBuffer( arrayOffset, float32Array, uint32Array, node ) {

			const isLeaf = ! ! node.count;
			const boundingData = node.boundingData;
			for ( let i = 0; i < 6; i ++ ) {

				float32Array[ arrayOffset + i ] = boundingData[ i ];

			}

			if ( isLeaf ) {

				const offset = node.offset;
				const count = node.count;
				uint32Array[ arrayOffset + 6 ] = offset;
				uint32Array[ arrayOffset + 7 ] = count;
				uint32Array[ arrayOffset + 8 ] = IS_LEAFNODE_FLAG;
				return arrayOffset + BYTES_PER_NODE / 4;

			} else {

				const left = node.left;
				const right = node.right;
				const splitAxis = node.splitAxis;

				let nextUnusedPointer;

				uint32Array[ arrayOffset + 6 ] = arrayOffset + BYTES_PER_NODE / 4;
				nextUnusedPointer = populateBuffer( arrayOffset + BYTES_PER_NODE / 4, float32Array, uint32Array, left );

				uint32Array[ arrayOffset + 7 ] = nextUnusedPointer;
				nextUnusedPointer = populateBuffer( nextUnusedPointer, float32Array, uint32Array, right );

				uint32Array[ arrayOffset + 8 ] = splitAxis;
				return nextUnusedPointer;

			}

		}

		const roots = bvh._roots;
		const rootData = [];
		for ( let i = 0; i < roots.length; i ++ ) {

			const root = roots[ i ];
			let nodeCount = countNodes( root );

			const buffer = new ArrayBuffer( BYTES_PER_NODE * nodeCount );
			const float32Array = new Float32Array( buffer );
			const uint32Array = new Uint32Array( buffer );
			rootData.push( buffer );
			populateBuffer( 0, float32Array, uint32Array, root );

		}

		const indexAttribute = geometry.getIndex();
		const result = {
			roots: rootData,
			index: copyIndexBuffer ? indexAttribute.array.slice() : indexAttribute.array,
		};

		return result;

	}

	static deserialize( data, geometry, setIndex = true ) {

		function setData( arrayOffset, float32Array, uint32Array, node ) {

			const boundingData = new Float32Array( 6 );
			for ( let i = 0; i < 6; i ++ ) {

				boundingData[ i ] = float32Array[ arrayOffset + i ];

			}
			node.boundingData = boundingData;

			const isLeaf = uint32Array[ arrayOffset + 8 ] === IS_LEAFNODE_FLAG;
			if ( isLeaf ) {

				node.offset = uint32Array[ arrayOffset + 6 ];
				node.count = uint32Array[ arrayOffset + 7 ];

			} else {

				const left = new MeshBVHNode();
				const right = new MeshBVHNode();
				const leftOffset = uint32Array[ arrayOffset + 6 ];
				const rightOffset = uint32Array[ arrayOffset + 7 ];

				setData( leftOffset, float32Array, uint32Array, left );
				setData( rightOffset, float32Array, uint32Array, right );

				node.left = left;
				node.right = right;
				node.splitAxis = uint32Array[ arrayOffset + 8 ];

			}

		}

		const { index, roots } = data;
		const bvh = new MeshBVH( geometry, { [ SKIP_GENERATION ]: true } );
		bvh._roots = roots.map( buffer => {

			const float32Array = new Float32Array( buffer );
			const uint32Array = new Uint32Array( buffer );

			const root = new MeshBVHNode();
			setData( 0, float32Array, uint32Array, root );
			return root;

		} );

		if ( setIndex ) {

			const indexAttribute = geometry.getIndex();
			if ( indexAttribute.array !== index ) {

				indexAttribute.array.set( index );
				indexAttribute.needsUpdate = true;

			}

		}

		return bvh;

	}

	constructor( geo, options = {} ) {

		if ( ! geo.isBufferGeometry ) {

			throw new Error( 'MeshBVH: Only BufferGeometries are supported.' );

		} else if ( geo.attributes.position.isInterleavedBufferAttribute ) {

			throw new Error( 'MeshBVH: InterleavedBufferAttribute is not supported for the position attribute.' );

		} else if ( geo.index && geo.index.isInterleavedBufferAttribute ) {

			throw new Error( 'MeshBVH: InterleavedBufferAttribute is not supported for the index attribute.' );

		}

		// default options
		options = Object.assign( {

			strategy: CENTER,
			maxDepth: 40,
			maxLeafTris: 10,
			verbose: true,
			[ SKIP_GENERATION ]: false

		}, options );
		options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

		if ( options[ SKIP_GENERATION ] ) {

			this._roots = null;

		} else {

			this._roots = this._buildTree( geo, options );

		}

	}

	/* Private Functions */
	_ensureIndex( geo ) {

		if ( ! geo.index ) {

			const vertexCount = geo.attributes.position.count;
			const index = new ( vertexCount > 65535 ? Uint32Array : Uint16Array )( vertexCount );
			geo.setIndex( new THREE.BufferAttribute( index, 1 ) );

			for ( let i = 0; i < vertexCount; i ++ ) {

				index[ i ] = i;

			}

		}

	}

	// Computes the set of { offset, count } ranges which need independent BVH roots. Each
	// region in the geometry index that belongs to a different set of material groups requires
	// a separate BVH root, so that triangles indices belonging to one group never get swapped
	// with triangle indices belongs to another group. For example, if the groups were like this:
	//
	// [-------------------------------------------------------------]
	// |__________________|
	//   g0 = [0, 20]  |______________________||_____________________|
	//                      g1 = [16, 40]           g2 = [41, 60]
	//
	// we would need four BVH roots: [0, 15], [16, 20], [21, 40], [41, 60].
	//
	_getRootIndexRanges( geo ) {

		if ( ! geo.groups || ! geo.groups.length ) {

			return [ { offset: 0, count: geo.index.count / 3 } ];

		}

		const ranges = [];
		const rangeBoundaries = new Set();
		for ( const group of geo.groups ) {

			rangeBoundaries.add( group.start );
			rangeBoundaries.add( group.start + group.count );

		}

		// note that if you don't pass in a comparator, it sorts them lexicographically as strings :-(
		const sortedBoundaries = Array.from( rangeBoundaries.values() ).sort( ( a, b ) => a - b );
		for ( let i = 0; i < sortedBoundaries.length - 1; i ++ ) {

			const start = sortedBoundaries[ i ], end = sortedBoundaries[ i + 1 ];
			ranges.push( { offset: ( start / 3 ), count: ( end - start ) / 3 } );

		}
		return ranges;

	}

	_buildTree( geo, options ) {

		this._ensureIndex( geo );

		const ctx = new BVHConstructionContext( geo, options );
		const cacheCentroidBounds = new Float32Array( 6 );
		let reachedMaxDepth = false;

		// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
		// recording the offset and count of its triangles and writing them into the reordered geometry index.
		const splitNode = ( node, offset, count, centroidBounds = null, depth = 0 ) => {

			if ( depth >= options.maxDepth ) {

				reachedMaxDepth = true;

			}

			// early out if we've met our capacity
			if ( count <= options.maxLeafTris || depth >= options.maxDepth ) {

				node.offset = offset;
				node.count = count;
				return node;

			}

			// Find where to split the volume
			const split = ctx.getOptimalSplit( node.boundingData, centroidBounds, offset, count, options.strategy );
			if ( split.axis === - 1 ) {

				node.offset = offset;
				node.count = count;
				return node;

			}

			const splitOffset = ctx.partition( offset, count, split );

			// create the two new child nodes
			if ( splitOffset === offset || splitOffset === offset + count ) {

				node.offset = offset;
				node.count = count;

			} else {

				node.splitAxis = split.axis;

				// create the left child and compute its bounding box
				const left = node.left = new MeshBVHNode();
				const lstart = offset, lcount = splitOffset - offset;
				left.boundingData = new Float32Array( 6 );
				ctx.getBounds( lstart, lcount, left.boundingData, cacheCentroidBounds );

				splitNode( left, lstart, lcount, cacheCentroidBounds, depth + 1 );

				// repeat for right
				const right = node.right = new MeshBVHNode();
				const rstart = splitOffset, rcount = count - lcount;
				right.boundingData = new Float32Array( 6 );
				ctx.getBounds( rstart, rcount, right.boundingData, cacheCentroidBounds );

				splitNode( right, rstart, rcount, cacheCentroidBounds, depth + 1 );

			}

			return node;

		};

		const roots = [];
		const ranges = this._getRootIndexRanges( geo );

		if ( ranges.length === 1 ) {

			const root = new MeshBVHNode();
			const range = ranges[ 0 ];

			if ( geo.boundingBox != null ) {

				root.boundingData = boxToArray( geo.boundingBox );
				ctx.getCentroidBounds( range.offset, range.count, cacheCentroidBounds );

			} else {

				root.boundingData = new Float32Array( 6 );
				ctx.getBounds( range.offset, range.count, root.boundingData, cacheCentroidBounds );

			}

			splitNode( root, range.offset, range.count, cacheCentroidBounds );
			roots.push( root );

		} else {

			for ( let range of ranges ) {

				const root = new MeshBVHNode();
				root.boundingData = new Float32Array( 6 );
				ctx.getBounds( range.offset, range.count, root.boundingData, cacheCentroidBounds );

				splitNode( root, range.offset, range.count, cacheCentroidBounds );
				roots.push( root );

			}

		}

		if ( reachedMaxDepth && options.verbose ) {

			console.warn( `MeshBVH: Max depth of ${ options.maxDepth } reached when generating BVH. Consider increasing maxDepth.` );
			console.warn( this, geo );

		}

		// if the geometry doesn't have a bounding box, then let's politely populate it using
		// the work we did to determine the BVH root bounds

		if ( geo.boundingBox == null ) {

			const rootBox = new THREE.Box3();
			geo.boundingBox = new THREE.Box3();

			for ( let root of roots ) {

				geo.boundingBox.union( arrayToBox( root.boundingData, rootBox ) );

			}

		}

		return roots;

	}

	/* Public Functions */
	raycast( mesh, raycaster, ray, intersects ) {

		for ( const root of this._roots ) {

			raycast( root, mesh, raycaster, ray, intersects );

		}

	}

	raycastFirst( mesh, raycaster, ray ) {

		let closestResult = null;

		for ( const root of this._roots ) {

			const result = raycastFirst( root, mesh, raycaster, ray );
			if ( result != null && ( closestResult == null || result.distance < closestResult.distance ) ) {

				closestResult = result;

			}

		}

		return closestResult;

	}

	intersectsGeometry( mesh, geometry, geomToMesh ) {

		for ( const root of this._roots ) {

			if ( intersectsGeometry( root, mesh, geometry, geomToMesh ) ) return true;

		}

		return false;

	}

	shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc = null, orderNodesFunc = null ) {

		for ( const root of this._roots ) {

			if ( shapecast( root, mesh, intersectsBoundsFunc, intersectsTriangleFunc, orderNodesFunc ) ) return true;

		}

		return false;

	}

	intersectsBox( mesh, box, boxToMesh ) {

		for ( const root of this._roots ) {

			if ( intersectsBox( root, mesh, box, boxToMesh ) ) return true;

		}

		return false;

	}

	intersectsSphere( mesh, sphere ) {

		for ( const root of this._roots ) {

			if ( intersectsSphere( root, mesh, sphere ) ) return true;

		}

		return false;

	}

	closestPointToGeometry( mesh, geom, matrix, target1, target2, minThreshold, maxThreshold ) {

		let closestDistance = Infinity;
		for ( const root of this._roots ) {

			const dist = closestPointToGeometry( root, mesh, geom, matrix, target1, target2, minThreshold, maxThreshold );
			if ( dist < closestDistance ) closestDistance = dist;
			if ( dist < minThreshold ) return dist;

		}

		return closestDistance;

	}

	distanceToGeometry( mesh, geom, matrix, minThreshold, maxThreshold ) {

		return this.closestPointToGeometry( mesh, geom, matrix, null, null, minThreshold, maxThreshold );

	}

	closestPointToPoint( mesh, point, target, minThreshold, maxThreshold ) {

		let closestDistance = Infinity;
		for ( const root of this._roots ) {

			const dist = closestPointToPoint( root, mesh, point, target, minThreshold, maxThreshold );
			if ( dist < closestDistance ) closestDistance = dist;
			if ( dist < minThreshold ) return dist;

		}

		return closestDistance;

	}

	distanceToPoint( mesh, point, minThreshold, maxThreshold ) {

		return this.closestPointToPoint( mesh, point, null, minThreshold, maxThreshold );

	}

}
