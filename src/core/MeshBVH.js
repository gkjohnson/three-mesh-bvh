import { Vector3, BufferAttribute, Box3, FrontSide, Matrix4 } from 'three';
import { CENTER, BYTES_PER_NODE, IS_LEAFNODE_FLAG, SKIP_GENERATION } from './Constants.js';
import { buildPackedTree } from './build/buildTree.js';
import { OrientedBox } from '../math/OrientedBox.js';
import { ExtendedTriangle } from '../math/ExtendedTriangle.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';
import { iterateOverTriangles, setTriangle } from '../utils/TriangleUtilities.js';
import { raycast } from './cast/raycast.js';
import { raycastFirst } from './cast/raycastFirst.js';
import { shapecast } from './cast/shapecast.js';
import { intersectsGeometry } from './cast/intersectsGeometry.js';
import { getTriCount } from './build/geometryUtils.js';
import { bvhcast } from './cast/bvhcast.js';
import { closestPointToGeometry } from './cast/closestPointToGeometry.js';

const tempMatrix = /* @__PURE__ */ new Matrix4();
const obb = /* @__PURE__ */ new OrientedBox();
const obb2 = /* @__PURE__ */ new OrientedBox();
const temp = /* @__PURE__ */ new Vector3();
const temp1 = /* @__PURE__ */ new Vector3();
const temp2 = /* @__PURE__ */ new Vector3();
const temp3 = /* @__PURE__ */ new Vector3();
const temp4 = /* @__PURE__ */ new Vector3();
const tempBox = /* @__PURE__ */ new Box3();
const trianglePool = /* @__PURE__ */ new PrimitivePool( () => new ExtendedTriangle() );

export class MeshBVH {

	static serialize( bvh, options = {} ) {

		options = {
			cloneBuffers: true,
			...options,
		};

		const geometry = bvh.geometry;
		const rootData = bvh._roots;
		const indirectBuffer = bvh.indirectBuffer;
		const indexAttribute = geometry.getIndex();
		let result;
		if ( options.cloneBuffers ) {

			result = {
				roots: rootData.map( root => root.slice() ),
				index: indexAttribute.array.slice(),
				indirectBuffer: indirectBuffer ? indirectBuffer.slice() : null,
			};

		} else {

			result = {
				roots: rootData,
				index: indexAttribute.array,
				indirectBuffer: indirectBuffer,
			};

		}

		return result;

	}

	static deserialize( data, geometry, options = {} ) {

		options = {
			setIndex: true,
			indirect: Boolean( data.indirectBuffer ),
			...options,
		};

		const { index, roots, indirectBuffer } = data;
		const bvh = new MeshBVH( geometry, { ...options, [ SKIP_GENERATION ]: true } );
		bvh._roots = roots;
		bvh._indirectBuffer = indirectBuffer || null;

		if ( options.setIndex ) {

			const indexAttribute = geometry.getIndex();
			if ( indexAttribute === null ) {

				const newIndex = new BufferAttribute( data.index, 1, false );
				geometry.setIndex( newIndex );

			} else if ( indexAttribute.array !== index ) {

				indexAttribute.array.set( index );
				indexAttribute.needsUpdate = true;

			}

		}

		return bvh;

	}

	constructor( geometry, options = {} ) {

		if ( ! geometry.isBufferGeometry ) {

			throw new Error( 'MeshBVH: Only BufferGeometries are supported.' );

		} else if ( geometry.index && geometry.index.isInterleavedBufferAttribute ) {

			throw new Error( 'MeshBVH: InterleavedBufferAttribute is not supported for the index attribute.' );

		}

		// default options
		options = Object.assign( {

			strategy: CENTER,
			maxDepth: 40,
			maxLeafTris: 10,
			verbose: true,
			useSharedArrayBuffer: false,
			setBoundingBox: true,
			onProgress: null,
			indirect: false,

			// undocumented options

			// Whether to skip generating the tree. Used for deserialization.
			[ SKIP_GENERATION ]: false,

		}, options );

		if ( options.useSharedArrayBuffer && typeof SharedArrayBuffer === 'undefined' ) {

			throw new Error( 'MeshBVH: SharedArrayBuffer is not available.' );

		}

		// retain references to the geometry so we can use them it without having to
		// take a geometry reference in every function.
		this.geometry = geometry;
		this._roots = null;
		this._indirectBuffer = null;
		if ( ! options[ SKIP_GENERATION ] ) {

			buildPackedTree( this, options );

			if ( ! geometry.boundingBox && options.setBoundingBox ) {

				geometry.boundingBox = this.getBoundingBox( new Box3() );

			}

		}

		const { _indirectBuffer } = this;
		this.resolveTriangleIndex = options.indirect ? i => _indirectBuffer[ i ] : i => i;

	}

	refit( nodeIndices = null ) {

		if ( nodeIndices && Array.isArray( nodeIndices ) ) {

			nodeIndices = new Set( nodeIndices );

		}

		const bvh = this;
		const geometry = this.geometry;
		const indexArr = geometry.index ? geometry.index.array : null;
		const posAttr = geometry.attributes.position;

		let buffer, uint32Array, uint16Array, float32Array;
		let byteOffset = 0;
		const roots = this._roots;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			buffer = roots[ i ];
			uint32Array = new Uint32Array( buffer );
			uint16Array = new Uint16Array( buffer );
			float32Array = new Float32Array( buffer );

			_traverse( 0, byteOffset );
			byteOffset += buffer.byteLength;

		}

		function _traverse( node32Index, byteOffset, force = false ) {

			const node16Index = node32Index * 2;
			const isLeaf = uint16Array[ node16Index + 15 ] === IS_LEAFNODE_FLAG;
			if ( isLeaf ) {

				const offset = uint32Array[ node32Index + 6 ];
				const count = uint16Array[ node16Index + 14 ];

				let minx = Infinity;
				let miny = Infinity;
				let minz = Infinity;
				let maxx = - Infinity;
				let maxy = - Infinity;
				let maxz = - Infinity;

				for ( let i = offset, l = offset + count; i < l; i ++ ) {

					const t = 3 * bvh.resolveTriangleIndex( i );
					for ( let j = 0; j < 3; j ++ ) {

						let index = t + j;
						index = indexArr ? indexArr[ index ] : index;

						const x = posAttr.getX( index );
						const y = posAttr.getY( index );
						const z = posAttr.getZ( index );

						if ( x < minx ) minx = x;
						if ( x > maxx ) maxx = x;

						if ( y < miny ) miny = y;
						if ( y > maxy ) maxy = y;

						if ( z < minz ) minz = z;
						if ( z > maxz ) maxz = z;

					}

				}

				if (
					float32Array[ node32Index + 0 ] !== minx ||
					float32Array[ node32Index + 1 ] !== miny ||
					float32Array[ node32Index + 2 ] !== minz ||

					float32Array[ node32Index + 3 ] !== maxx ||
					float32Array[ node32Index + 4 ] !== maxy ||
					float32Array[ node32Index + 5 ] !== maxz
				) {

					float32Array[ node32Index + 0 ] = minx;
					float32Array[ node32Index + 1 ] = miny;
					float32Array[ node32Index + 2 ] = minz;

					float32Array[ node32Index + 3 ] = maxx;
					float32Array[ node32Index + 4 ] = maxy;
					float32Array[ node32Index + 5 ] = maxz;

					return true;

				} else {

					return false;

				}

			} else {

				const left = node32Index + 8;
				const right = uint32Array[ node32Index + 6 ];

				// the identifying node indices provided by the shapecast function include offsets of all
				// root buffers to guarantee they're unique between roots so offset left and right indices here.
				const offsetLeft = left + byteOffset;
				const offsetRight = right + byteOffset;
				let forceChildren = force;
				let includesLeft = false;
				let includesRight = false;

				if ( nodeIndices ) {

					// if we see that neither the left or right child are included in the set that need to be updated
					// then we assume that all children need to be updated.
					if ( ! forceChildren ) {

						includesLeft = nodeIndices.has( offsetLeft );
						includesRight = nodeIndices.has( offsetRight );
						forceChildren = ! includesLeft && ! includesRight;

					}

				} else {

					includesLeft = true;
					includesRight = true;

				}

				const traverseLeft = forceChildren || includesLeft;
				const traverseRight = forceChildren || includesRight;

				let leftChange = false;
				if ( traverseLeft ) {

					leftChange = _traverse( left, byteOffset, forceChildren );

				}

				let rightChange = false;
				if ( traverseRight ) {

					rightChange = _traverse( right, byteOffset, forceChildren );

				}

				const didChange = leftChange || rightChange;
				if ( didChange ) {

					for ( let i = 0; i < 3; i ++ ) {

						const lefti = left + i;
						const righti = right + i;
						const minLeftValue = float32Array[ lefti ];
						const maxLeftValue = float32Array[ lefti + 3 ];
						const minRightValue = float32Array[ righti ];
						const maxRightValue = float32Array[ righti + 3 ];

						float32Array[ node32Index + i ] = minLeftValue < minRightValue ? minLeftValue : minRightValue;
						float32Array[ node32Index + i + 3 ] = maxLeftValue > maxRightValue ? maxLeftValue : maxRightValue;

					}

				}

				return didChange;

			}

		}

	}

	traverse( callback, rootIndex = 0 ) {

		const buffer = this._roots[ rootIndex ];
		const uint32Array = new Uint32Array( buffer );
		const uint16Array = new Uint16Array( buffer );
		_traverse( 0 );

		function _traverse( node32Index, depth = 0 ) {

			const node16Index = node32Index * 2;
			const isLeaf = uint16Array[ node16Index + 15 ] === IS_LEAFNODE_FLAG;
			if ( isLeaf ) {

				const offset = uint32Array[ node32Index + 6 ];
				const count = uint16Array[ node16Index + 14 ];
				callback( depth, isLeaf, new Float32Array( buffer, node32Index * 4, 6 ), offset, count );

			} else {

				// TODO: use node functions here
				const left = node32Index + BYTES_PER_NODE / 4;
				const right = uint32Array[ node32Index + 6 ];
				const splitAxis = uint32Array[ node32Index + 7 ];
				const stopTraversal = callback( depth, isLeaf, new Float32Array( buffer, node32Index * 4, 6 ), splitAxis );

				if ( ! stopTraversal ) {

					_traverse( left, depth + 1 );
					_traverse( right, depth + 1 );

				}

			}

		}

	}

	/* Core Cast Functions */
	raycast( ray, materialOrSide = FrontSide ) {

		const roots = this._roots;
		const geometry = this.geometry;
		const intersects = [];
		const isMaterial = materialOrSide.isMaterial;
		const isArrayMaterial = Array.isArray( materialOrSide );

		const groups = geometry.groups;
		const side = isMaterial ? materialOrSide.side : materialOrSide;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			const materialSide = isArrayMaterial ? materialOrSide[ groups[ i ].materialIndex ].side : side;
			const startCount = intersects.length;

			raycast( this, i, materialSide, ray, intersects );

			if ( isArrayMaterial ) {

				const materialIndex = groups[ i ].materialIndex;
				for ( let j = startCount, jl = intersects.length; j < jl; j ++ ) {

					intersects[ j ].face.materialIndex = materialIndex;

				}

			}

		}

		return intersects;

	}

	raycastFirst( ray, materialOrSide = FrontSide ) {

		const roots = this._roots;
		const geometry = this.geometry;
		const isMaterial = materialOrSide.isMaterial;
		const isArrayMaterial = Array.isArray( materialOrSide );

		let closestResult = null;

		const groups = geometry.groups;
		const side = isMaterial ? materialOrSide.side : materialOrSide;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			const materialSide = isArrayMaterial ? materialOrSide[ groups[ i ].materialIndex ].side : side;
			const result = raycastFirst( this, i, materialSide, ray );
			if ( result != null && ( closestResult == null || result.distance < closestResult.distance ) ) {

				closestResult = result;
				if ( isArrayMaterial ) {

					result.face.materialIndex = groups[ i ].materialIndex;

				}

			}

		}

		return closestResult;

	}

	intersectsGeometry( otherGeometry, geomToMesh ) {

		let result = false;
		const roots = this._roots;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			result = intersectsGeometry( this, i, otherGeometry, geomToMesh );

			if ( result ) {

				break;

			}

		}

		return result;

	}

	shapecast( callbacks ) {

		const triangle = trianglePool.getPrimitive();
		let {
			boundsTraverseOrder,
			intersectsBounds,
			intersectsRange,
			intersectsTriangle,
		} = callbacks;

		// wrap the intersectsRange function
		if ( intersectsRange && intersectsTriangle ) {

			const originalIntersectsRange = intersectsRange;
			intersectsRange = ( offset, count, contained, depth, nodeIndex ) => {

				if ( ! originalIntersectsRange( offset, count, contained, depth, nodeIndex ) ) {

					return iterateOverTriangles( offset, count, this, intersectsTriangle, contained, depth, triangle );

				}

				return true;

			};

		} else if ( ! intersectsRange ) {

			if ( intersectsTriangle ) {

				intersectsRange = ( offset, count, contained, depth ) => {

					return iterateOverTriangles( offset, count, this, intersectsTriangle, contained, depth, triangle );

				};

			} else {

				intersectsRange = ( offset, count, contained ) => {

					return contained;

				};

			}

		}

		// run shapecast
		let result = false;
		let byteOffset = 0;
		const roots = this._roots;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			const root = roots[ i ];
			result = shapecast( this, i, intersectsBounds, intersectsRange, boundsTraverseOrder, byteOffset );

			if ( result ) {

				break;

			}

			byteOffset += root.byteLength;

		}

		trianglePool.releasePrimitive( triangle );

		return result;

	}

	bvhcast( otherBvh, matrixToLocal, callbacks ) {

		return bvhcast( this, otherBvh, matrixToLocal, callbacks );

	}

	/* Derived Cast Functions */
	intersectsBox( box, boxToMesh ) {

		obb.set( box.min, box.max, boxToMesh );
		obb.needsUpdate = true;

		return this.shapecast(
			{
				intersectsBounds: box => obb.intersectsBox( box ),
				intersectsTriangle: tri => obb.intersectsTriangle( tri )
			}
		);

	}

	intersectsSphere( sphere ) {

		return this.shapecast(
			{
				intersectsBounds: box => sphere.intersectsBox( box ),
				intersectsTriangle: tri => tri.intersectsSphere( sphere )
			}
		);

	}

	closestPointToGeometry( otherGeometry, geometryToBvh, target1 = { }, target2 = { }, minThreshold = 0, maxThreshold = Infinity ) {

		return closestPointToGeometry( this, otherGeometry, geometryToBvh, target1, target2, minThreshold, maxThreshold );

	}

	closestPointToPoint( point, target = { }, minThreshold = 0, maxThreshold = Infinity ) {

		// early out if under minThreshold
		// skip checking if over maxThreshold
		// set minThreshold = maxThreshold to quickly check if a point is within a threshold
		// returns Infinity if no value found
		const minThresholdSq = minThreshold * minThreshold;
		const maxThresholdSq = maxThreshold * maxThreshold;
		let closestDistanceSq = Infinity;
		let closestDistanceTriIndex = null;
		this.shapecast(

			{

				boundsTraverseOrder: box => {

					temp.copy( point ).clamp( box.min, box.max );
					return temp.distanceToSquared( point );

				},

				intersectsBounds: ( box, isLeaf, score ) => {

					return score < closestDistanceSq && score < maxThresholdSq;

				},

				intersectsTriangle: ( tri, triIndex ) => {

					tri.closestPointToPoint( point, temp );
					const distSq = point.distanceToSquared( temp );
					if ( distSq < closestDistanceSq ) {

						temp1.copy( temp );
						closestDistanceSq = distSq;
						closestDistanceTriIndex = triIndex;

					}

					if ( distSq < minThresholdSq ) {

						return true;

					} else {

						return false;

					}

				},

			}

		);

		if ( closestDistanceSq === Infinity ) return null;

		const closestDistance = Math.sqrt( closestDistanceSq );

		if ( ! target.point ) target.point = temp1.clone();
		else target.point.copy( temp1 );
		target.distance = closestDistance,
		target.faceIndex = closestDistanceTriIndex;

		return target;

	}

	getBoundingBox( target ) {

		target.makeEmpty();

		const roots = this._roots;
		roots.forEach( buffer => {

			arrayToBox( 0, new Float32Array( buffer ), tempBox );
			target.union( tempBox );

		} );

		return target;

	}

}
