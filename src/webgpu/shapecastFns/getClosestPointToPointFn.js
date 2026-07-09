/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { mat4 } from 'three/tsl';
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { bvhNodeStruct, bvhNodeBoundsStruct, pointQueryResultStruct } from '../tsl/structs.js';
import { closestPointToTriangle } from '../tsl/fns.js';

/**
 * Builds the `closestPointToPoint` shapecast function: finds the closest point on any triangle in
 * the BVH to the given query point.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @returns {Function} TSL function node for the TLAS traversal.
 */
export function getClosestPointToPointFn( bvhData ) {

	// these are proxy nodes, so they can be referenced before the storage buffers exist
	const { index, attributes, transforms } = bvhData.storage;

	const scratchToWorldMat = mat4().toVar( 'bvh_toWorldMat' );

	return bvhData.getShapecastFn( {
		name: 'bvh_ClosestPointToPoint',
		shapeStruct: 'vec3f',
		resultStruct: pointQueryResultStruct,

		boundsOrderFn: wgslTagFn/* wgsl */`
			fn cppBoundsOrder( shape: vec3f, splitAxis: u32, node: ${ bvhNodeStruct } ) -> bool {

				let toWorld = ${ scratchToWorldMat };

				// get center
				let bMin = vec3f( node.bounds.min[ 0 ], node.bounds.min[ 1 ], node.bounds.min[ 2 ] );
				let bMax = vec3f( node.bounds.max[ 0 ], node.bounds.max[ 1 ], node.bounds.max[ 2 ] );
				let center = bMin * 0.5 + bMax * 0.5;

				// determine the order in world space
				let worldCenter = ( toWorld * vec4f( center, 1.0 ) ).xyz;
				let worldAxis = normalize( toWorld[ splitAxis ].xyz );
				return dot( shape - worldCenter, worldAxis ) <= 0.0;

			}
		`,

		intersectsBoundsFn: wgslTagFn/* wgsl */`
			fn cppIntersectsBounds( shape: vec3f, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ pointQueryResultStruct }> ) -> u32 {

				// return 1u;
				// we need to check this no matter what if the result has not been found yet
				if ( ! result.found ) {

					return 1u;

				}

				let toWorld = ${ scratchToWorldMat };

				// transform to world space
				let bMin = vec3f( bounds.min[ 0 ], bounds.min[ 1 ], bounds.min[ 2 ] );
				let bMax = vec3f( bounds.max[ 0 ], bounds.max[ 1 ], bounds.max[ 2 ] );
				let center = ( bMin + bMax ) * 0.5;
				let halfExtent = ( bMax - bMin ) * 0.5;
				let worldCenter = ( toWorld * vec4f( center, 1.0 ) ).xyz;
				let worldHalfExtent =
					abs( toWorld[ 0 ].xyz ) * halfExtent.x +
				    abs( toWorld[ 1 ].xyz ) * halfExtent.y +
				    abs( toWorld[ 2 ].xyz ) * halfExtent.z;
				let worldMin = worldCenter - worldHalfExtent;
				let worldMax = worldCenter + worldHalfExtent;

				// intersect if the distance to the bounds is not bigger than the already found
				let d = shape - clamp( shape, worldMin, worldMax );
				return select( 0u, 1u, dot( d, d ) < result.distanceSq );

			}
		`,

		intersectRangeFn: wgslTagFn /* wgsl */`
			fn cppIntersectsRange( shape: vec3f, offset: u32, count: u32, result: ptr<function, ${ pointQueryResultStruct }> ) -> bool {

				var didHit = false;
				let toWorld = ${ scratchToWorldMat };

				for ( var i = offset; i < offset + count; i ++ ) {

					// transform the triangle to world space
					let i0 = ${ index }[ i * 3u + 0u ];
					let i1 = ${ index }[ i * 3u + 1u ];
					let i2 = ${ index }[ i * 3u + 2u ];
					let a = ( toWorld * vec4f( ${ attributes }[ i0 ].position.xyz, 1.0 ) ).xyz;
					let b = ( toWorld * vec4f( ${ attributes }[ i1 ].position.xyz, 1.0 ) ).xyz;
					let c = ( toWorld * vec4f( ${ attributes }[ i2 ].position.xyz, 1.0 ) ).xyz;

					let barycoord = ${ closestPointToTriangle }( shape, a, b, c );
					let closestPoint = barycoord.x * a + barycoord.y * b + barycoord.z * c;
					let delta = shape - closestPoint;
					let distSq = dot( delta, delta );

					// copy the content over
					if ( ! result.found || distSq < result.distanceSq ) {

						let normal = normalize( cross( a - b, b - c ) );

						result.closestPoint = closestPoint;
						result.barycoord = barycoord;
						result.distanceSq = distSq;
						result.faceNormal = normal;
						result.side = sign( dot( normal, delta ) );
						result.faceIndices = vec4u( i0, i1, i2, i );
						result.found = true;
						didHit = true;

					}

				}

				return didHit;

			}
		`,

		resetShapeFn: wgslTagFn/* wgsl */`
				fn cppResetShape( objectIndex: u32 ) -> void {

					// node bounds are transformed by "toWorld" during the bounds tests. Only the
					// object-local BLAS bounds need the object's world matrix - the top-level bounds
					// are already in world space - so restore identity before top-level traversal resumes.
					${ scratchToWorldMat } = mat4x4f(
						1.0, 0.0, 0.0, 0.0,
						0.0, 1.0, 0.0, 0.0,
						0.0, 0.0, 1.0, 0.0,
						0.0, 0.0, 0.0, 1.0
					);

				}
			`,

		transformShapeFn: wgslTagFn/* wgsl */`
			fn cppTransformShape( shape: ptr<function, vec3f>, objectIndex: u32 ) -> void {

				${ scratchToWorldMat } = ${ transforms }[ objectIndex ].matrixWorld;

			}
		`,

		transformResultFn: wgslTagFn/* wgsl */`
			fn cppTransformResult( result: ptr<function, ${ pointQueryResultStruct }>, objectIndex: u32 ) -> void {

				result.objectIndex = objectIndex;

			}
		`,
	} );

}
