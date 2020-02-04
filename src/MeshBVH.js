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

// boundingData  				: 6 float32
// right / offset 				: 1 uint32
// splitAxis / isLeaf + count 	: 1 uint32 / 2 uint16
const BYTES_PER_NODE = 6 * 4 + 4 + 4;
const IS_LEAFNODE_FLAG = 0xFFFF;
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

		function populateBuffer( byteOffset, node ) {

			const stride4Offset = byteOffset / 4;
			const stride2Offset = byteOffset / 2;
			const isLeaf = ! ! node.count;
			const boundingData = node.boundingData;
			for ( let i = 0; i < 6; i ++ ) {

				float32Array[ stride4Offset + i ] = boundingData[ i ];

			}

			if ( isLeaf ) {

				const offset = node.offset;
				const count = node.count;
				uint32Array[ stride4Offset + 6 ] = offset;
				uint16Array[ stride2Offset + 14 ] = count;
				uint16Array[ stride2Offset + 15 ] = IS_LEAFNODE_FLAG;
				return byteOffset + BYTES_PER_NODE;

			} else {

				const left = node.left;
				const right = node.right;
				const splitAxis = node.splitAxis;

				let nextUnusedPointer;
				nextUnusedPointer = populateBuffer( byteOffset + BYTES_PER_NODE, left );

				uint32Array[ stride4Offset + 6 ] = nextUnusedPointer / 4;
				nextUnusedPointer = populateBuffer( nextUnusedPointer, right );

				uint32Array[ stride4Offset + 7 ] = splitAxis;
				return nextUnusedPointer;

			}

		}

		let float32Array;
		let uint32Array;
		let uint16Array;

		const roots = bvh._roots;
		const rootData = [];
		for ( let i = 0; i < roots.length; i ++ ) {

			const root = roots[ i ];
			finishTree( root );
			let nodeCount = countNodes( root );

			const buffer = new ArrayBuffer( BYTES_PER_NODE * nodeCount );
			float32Array = new Float32Array( buffer );
			uint32Array = new Uint32Array( buffer );
			uint16Array = new Uint16Array( buffer );
			populateBuffer( 0, root );
			rootData.push( buffer );

		}

		const indexAttribute = geometry.getIndex();
		const result = {
			roots: rootData,
			index: copyIndexBuffer ? indexAttribute.array.slice() : indexAttribute.array,
		};

		return result;

	}

	static deserialize( data, geometry, setIndex = true ) {

		function setData( byteOffset, node ) {

			const stride4Offset = byteOffset / 4;
			const stride2Offset = byteOffset / 2;
			const boundingData = new Float32Array( 6 );
			for ( let i = 0; i < 6; i ++ ) {

				boundingData[ i ] = float32Array[ stride4Offset + i ];

			}
			node.boundingData = boundingData;

			const isLeaf = uint16Array[ stride2Offset + 15 ] === IS_LEAFNODE_FLAG;
			if ( isLeaf ) {

				node.offset = uint32Array[ stride4Offset + 6 ];
				node.count = uint16Array[ stride2Offset + 14 ];

			} else {

				const left = new MeshBVHNode();
				const right = new MeshBVHNode();
				const leftOffset = stride4Offset + BYTES_PER_NODE / 4;
				const rightOffset = uint32Array[ stride4Offset + 6 ];

				setData( leftOffset * 4, left );
				setData( rightOffset * 4, right );

				node.left = left;
				node.right = right;
				node.splitAxis = uint32Array[ stride4Offset + 7 ];

			}

		}

		let float32Array;
		let uint32Array;
		let uint16Array;

		const { index, roots } = data;
		const bvh = new MeshBVH( geometry, { [ SKIP_GENERATION ]: true } );
		bvh._roots = [];
		for ( let i = 0; i < roots.length; i ++ ) {

			const buffer = roots[ i ];
			float32Array = new Float32Array( buffer );
			uint32Array = new Uint32Array( buffer );
			uint16Array = new Uint16Array( buffer );

			const root = new MeshBVHNode();
			setData( 0, root );
			bvh._roots.push( root );

		}

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
			packData: false,
			[ SKIP_GENERATION ]: false

		}, options );
		options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

		this._isPacked = false;
		this._roots = null;
		if ( ! options[ SKIP_GENERATION ] ) {

			this._roots = buildTree( geo, options );
			if ( options.packData ) {

				this._roots = MeshBVH.serialize( this, geo, false ).roots;
				this._isPacked = true;

			}

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
