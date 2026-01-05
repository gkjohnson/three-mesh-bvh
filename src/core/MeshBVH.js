import { BufferAttribute, FrontSide } from 'three';
import { CENTER, SKIP_GENERATION, BYTES_PER_NODE, UINT32_PER_NODE } from './Constants.js';
import { BVH } from './BVH.js';
import { OrientedBox } from '../math/OrientedBox.js';
import { ExtendedTrianglePool } from '../utils/ExtendedTrianglePool.js';
import { closestPointToPoint } from './cast/closestPointToPoint.js';
import { IS_LEAF } from './utils/nodeBufferUtils.js';
import { getTriCount, getRootIndexRanges, ensureIndex } from './build/geometryUtils.js';
import { computeTriangleBounds } from './build/computeBoundsUtils.js';

import { iterateOverTriangles } from './utils/iterationUtils.generated.js';
import { refit } from './cast/refit.generated.js';
import { raycast } from './cast/raycast.generated.js';
import { raycastFirst } from './cast/raycastFirst.generated.js';
import { intersectsGeometry } from './cast/intersectsGeometry.generated.js';
import { closestPointToGeometry } from './cast/closestPointToGeometry.generated.js';

import { iterateOverTriangles_indirect } from './utils/iterationUtils_indirect.generated.js';
import { refit_indirect } from './cast/refit_indirect.generated.js';
import { raycast_indirect } from './cast/raycast_indirect.generated.js';
import { raycastFirst_indirect } from './cast/raycastFirst_indirect.generated.js';
import { intersectsGeometry_indirect } from './cast/intersectsGeometry_indirect.generated.js';
import { closestPointToGeometry_indirect } from './cast/closestPointToGeometry_indirect.generated.js';
import { setTriangle } from '../utils/TriangleUtilities.js';
import { bvhcast } from './cast/bvhcast.js';

const obb = /* @__PURE__ */ new OrientedBox();
export const DEFAULT_OPTIONS = {
	strategy: CENTER,
	maxDepth: 40,
	maxLeafTris: 10,
	useSharedArrayBuffer: false,
	setBoundingBox: true,
	onProgress: null,
	indirect: false,
	verbose: true,
	range: null
};

export class MeshBVH extends BVH {

	static serialize( bvh, options = {} ) {

		options = {
			cloneBuffers: true,
			...options,
		};

		const geometry = bvh.geometry;
		const rootData = bvh._roots;
		const indirectBuffer = bvh._indirectBuffer;
		const indexAttribute = geometry.getIndex();
		const result = {
			version: 1,
			roots: null,
			index: null,
			indirectBuffer: null,
		};
		if ( options.cloneBuffers ) {

			result.roots = rootData.map( root => root.slice() );
			result.index = indexAttribute ? indexAttribute.array.slice() : null;
			result.indirectBuffer = indirectBuffer ? indirectBuffer.slice() : null;

		} else {

			result.roots = rootData;
			result.index = indexAttribute ? indexAttribute.array : null;
			result.indirectBuffer = indirectBuffer;

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

		// handle backwards compatibility by fixing up the buffer roots
		// see issue gkjohnson/three-mesh-bvh#759
		if ( ! data.version ) {

			console.warn(
				'MeshBVH.deserialize: Serialization format has been changed and will be fixed up. ' +
				'It is recommended to regenerate any stored serialized data.'
			);
			fixupVersion0( roots );

		}

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

		// convert version 0 serialized data (uint32 indices) to version 1 (node indices)
		function fixupVersion0( roots ) {

			for ( let rootIndex = 0; rootIndex < roots.length; rootIndex ++ ) {

				const root = roots[ rootIndex ];
				const uint32Array = new Uint32Array( root );
				const uint16Array = new Uint16Array( root );

				// iterate over nodes and convert right child offsets
				for ( let node = 0, l = root.byteLength / BYTES_PER_NODE; node < l; node ++ ) {

					const node32Index = UINT32_PER_NODE * node;
					const node16Index = 2 * node32Index;
					if ( ! IS_LEAF( node16Index, uint16Array ) ) {

						// convert absolute right child offset to relative offset
						uint32Array[ node32Index + 6 ] = uint32Array[ node32Index + 6 ] / UINT32_PER_NODE - node;

					}

				}

			}

		}

	}

	get primitiveStride() {

		return 3;

	}

	get resolveTriangleIndex() {

		return this.resolvePrimitiveIndex;

	}

	constructor( geometry, options = {} ) {

		if ( ! geometry.isBufferGeometry ) {

			throw new Error( 'MeshBVH: Only BufferGeometries are supported.' );

		} else if ( geometry.index && geometry.index.isInterleavedBufferAttribute ) {

			throw new Error( 'MeshBVH: InterleavedBufferAttribute is not supported for the index attribute.' );

		}

		// default options
		options = Object.assign( {

			...DEFAULT_OPTIONS,

			// undocumented options

			// Whether to skip generating the tree. Used for deserialization.
			[ SKIP_GENERATION ]: false,

		}, options );

		// call parent constructor which handles tree building and bounding box
		super( geometry, options );

	}

	// implement abstract methods from BVH base class
	getPrimitiveCount() {

		return getTriCount( this.geometry );

	}

	computePrimitiveBounds( offset, count ) {

		const indirectBuffer = this._indirectBuffer;
		return computeTriangleBounds( this.geometry, offset, count, indirectBuffer );

	}

	getBuildRanges( options ) {

		if ( options.indirect ) {

			// For indirect mode, return ranges for generating the indirect buffer
			return getRootIndexRanges( this.geometry, options.range, 3 );

		} else {

			// For direct mode, ensure index exists and return geometry ranges
			ensureIndex( this.geometry, options );
			return getRootIndexRanges( this.geometry, options.range, 3 );

		}

	}

	// TODO: move to base class?
	refit( nodeIndices = null ) {

		const refitFunc = this.indirect ? refit_indirect : refit;
		return refitFunc( this, nodeIndices );

	}

	/* Core Cast Functions */
	raycast( ray, materialOrSide = FrontSide, near = 0, far = Infinity ) {

		const roots = this._roots;
		const intersects = [];
		const raycastFunc = this.indirect ? raycast_indirect : raycast;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			raycastFunc( this, i, materialOrSide, ray, intersects, near, far );

		}

		return intersects;

	}

	raycastFirst( ray, materialOrSide = FrontSide, near = 0, far = Infinity ) {

		const roots = this._roots;
		let closestResult = null;

		const raycastFirstFunc = this.indirect ? raycastFirst_indirect : raycastFirst;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			const result = raycastFirstFunc( this, i, materialOrSide, ray, near, far );
			if ( result != null && ( closestResult == null || result.distance < closestResult.distance ) ) {

				closestResult = result;

			}

		}

		return closestResult;

	}

	intersectsGeometry( otherGeometry, geomToMesh ) {

		let result = false;
		const roots = this._roots;
		const intersectsGeometryFunc = this.indirect ? intersectsGeometry_indirect : intersectsGeometry;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			result = intersectsGeometryFunc( this, i, otherGeometry, geomToMesh );

			if ( result ) {

				break;

			}

		}

		return result;

	}

	shapecast( callbacks ) {

		const triangle = ExtendedTrianglePool.getPrimitive();
		const result = this._shapecast(
			iterateOverTriangles,
			iterateOverTriangles_indirect,
			triangle,
			{
				...callbacks,
				intersectsPrimitive: callbacks.intersectsTriangle,
			}
		);
		ExtendedTrianglePool.releasePrimitive( triangle );

		return result;

	}

	bvhcast( otherBvh, matrixToLocal, callbacks ) {

		let {
			intersectsRanges,
			intersectsTriangles,
		} = callbacks;

		const triangle1 = ExtendedTrianglePool.getPrimitive();
		const indexAttr1 = this.geometry.index;
		const positionAttr1 = this.geometry.attributes.position;
		const assignTriangle1 = this.indirect ?
			i1 => {


				const ti = this.resolveTriangleIndex( i1 );
				setTriangle( triangle1, ti * 3, indexAttr1, positionAttr1 );

			} :
			i1 => {

				setTriangle( triangle1, i1 * 3, indexAttr1, positionAttr1 );

			};

		const triangle2 = ExtendedTrianglePool.getPrimitive();
		const indexAttr2 = otherBvh.geometry.index;
		const positionAttr2 = otherBvh.geometry.attributes.position;
		const assignTriangle2 = otherBvh.indirect ?
			i2 => {

				const ti2 = otherBvh.resolveTriangleIndex( i2 );
				setTriangle( triangle2, ti2 * 3, indexAttr2, positionAttr2 );

			} :
			i2 => {

				setTriangle( triangle2, i2 * 3, indexAttr2, positionAttr2 );

			};

		// generate triangle callback if needed
		if ( intersectsTriangles ) {

			const iterateOverDoubleTriangles = ( offset1, count1, offset2, count2, depth1, nodeIndex1, depth2, nodeIndex2 ) => {

				for ( let i2 = offset2, l2 = offset2 + count2; i2 < l2; i2 ++ ) {

					assignTriangle2( i2 );

					triangle2.a.applyMatrix4( matrixToLocal );
					triangle2.b.applyMatrix4( matrixToLocal );
					triangle2.c.applyMatrix4( matrixToLocal );
					triangle2.needsUpdate = true;

					for ( let i1 = offset1, l1 = offset1 + count1; i1 < l1; i1 ++ ) {

						assignTriangle1( i1 );

						triangle1.needsUpdate = true;

						if ( intersectsTriangles( triangle1, triangle2, i1, i2, depth1, nodeIndex1, depth2, nodeIndex2 ) ) {

							return true;

						}

					}

				}

				return false;

			};

			if ( intersectsRanges ) {

				const originalIntersectsRanges = intersectsRanges;
				intersectsRanges = function ( offset1, count1, offset2, count2, depth1, nodeIndex1, depth2, nodeIndex2 ) {

					if ( ! originalIntersectsRanges( offset1, count1, offset2, count2, depth1, nodeIndex1, depth2, nodeIndex2 ) ) {

						return iterateOverDoubleTriangles( offset1, count1, offset2, count2, depth1, nodeIndex1, depth2, nodeIndex2 );

					}

					return true;

				};

			} else {

				intersectsRanges = iterateOverDoubleTriangles;

			}

		}

		return bvhcast( this, otherBvh, matrixToLocal, intersectsRanges );

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

		const closestPointToGeometryFunc = this.indirect ? closestPointToGeometry_indirect : closestPointToGeometry;
		return closestPointToGeometryFunc(
			this,
			otherGeometry,
			geometryToBvh,
			target1,
			target2,
			minThreshold,
			maxThreshold,
		);

	}

	closestPointToPoint( point, target = { }, minThreshold = 0, maxThreshold = Infinity ) {

		return closestPointToPoint(
			this,
			point,
			target,
			minThreshold,
			maxThreshold,
		);

	}

}
