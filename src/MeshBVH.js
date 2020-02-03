import MeshBVHNode from './MeshBVHNode.js';
import { CENTER } from './Constants.js';
import { buildTree } from './buildFunctions.js';
import {
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

		function finishTree( node ) {

			if ( node.continueGeneration ) {

				node.continueGeneration();

			}

			if ( ! node.count ) {

				finishTree( node.left );
				finishTree( node.right );

			}

		}

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
			finishTree( root );
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
			lazyGeneration: false,
			[ SKIP_GENERATION ]: false

		}, options );
		options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

		if ( options[ SKIP_GENERATION ] ) {

			this._roots = null;

		} else {

			this._roots = buildTree( geo, options );

		}

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
