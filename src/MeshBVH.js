import { Vector3, BufferAttribute, Box3, Matrix4 } from 'three';
import { CENTER } from './Constants.js';
import { BYTES_PER_NODE, IS_LEAFNODE_FLAG, buildPackedTree } from './buildFunctions.js';
import { OrientedBox } from './Utils/OrientedBox.js';
import { SeparatingAxisTriangle } from './Utils/SeparatingAxisTriangle.js';
import { setTriangle } from './Utils/TriangleUtils.js';
import {
	raycast,
	raycastFirst,
	shapecast,
	setBuffer,
	clearBuffer,
	setBuffer2,
	clearBuffer2,
	bvhcast,
} from './castFunctions.js';
import { arrayToBox, iterateOverTriangles } from './Utils/BufferNodeUtils.js';

const SKIP_GENERATION = Symbol( 'skip tree generation' );

const obb = new OrientedBox();
const obb2 = new OrientedBox();
const temp = new Vector3();
const temp1 = new Vector3();
const temp2 = new Vector3();
const tempBox = new Box3();
const triangle = new SeparatingAxisTriangle();
const triangle2 = new SeparatingAxisTriangle();

export default class MeshBVH {

	static serialize( bvh, geometry, copyIndexBuffer = true ) {

		const rootData = bvh._roots;
		const indexAttribute = geometry.getIndex();
		const result = {
			roots: rootData,
			index: copyIndexBuffer ? indexAttribute.array.slice() : indexAttribute.array,
		};

		return result;

	}

	static deserialize( data, geometry, setIndex = true ) {

		const { index, roots } = data;
		const bvh = new MeshBVH( geometry, { [ SKIP_GENERATION ]: true } );
		bvh._roots = roots;

		if ( setIndex ) {

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

		} else if ( geometry.attributes.position.isInterleavedBufferAttribute ) {

			throw new Error( 'MeshBVH: InterleavedBufferAttribute is not supported for the position attribute.' );

		} else if ( geometry.index && geometry.index.isInterleavedBufferAttribute ) {

			throw new Error( 'MeshBVH: InterleavedBufferAttribute is not supported for the index attribute.' );

		}

		// default options
		options = Object.assign( {

			strategy: CENTER,
			maxDepth: 40,
			maxLeafTris: 10,
			verbose: true,

			setBoundingBox: true,

			// undocumented options

			// Whether to skip generating the tree. Used for deserialization.
			[ SKIP_GENERATION ]: false

		}, options );
		options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

		this._roots = null;
		if ( ! options[ SKIP_GENERATION ] ) {

			this._roots = buildPackedTree( geometry, options );

			if ( ! geometry.boundingBox && options.setBoundingBox ) {

				geometry.boundingBox = this.getBoundingBox( new Box3() );

			}

		}

		// retain references to the geometry so we can use them it without having to
		// take a geometry reference in every function.
		this.geometry = geometry;

	}

	refit( nodeIndices = null, terminationIndices = null ) {

		if ( nodeIndices && Array.isArray( nodeIndices ) ) {

			nodeIndices = new Set( nodeIndices );

		}

		if ( terminationIndices && Array.isArray( terminationIndices ) ) {

			terminationIndices = new Set( terminationIndices );

		}

		const geometry = this.geometry;
		const indexArr = geometry.index.array;
		const posArr = geometry.attributes.position.array;
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
				for ( let i = 3 * offset, l = 3 * ( offset + count ); i < l; i ++ ) {

					const index3 = indexArr[ i ] * 3;
					const x = posArr[ index3 + 0 ];
					const y = posArr[ index3 + 1 ];
					const z = posArr[ index3 + 2 ];

					if ( x < minx ) minx = x;
					if ( x > maxx ) maxx = x;

					if ( y < miny ) miny = y;
					if ( y > maxy ) maxy = y;

					if ( z < minz ) minz = z;
					if ( z > maxz ) maxz = z;

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

				// the indentifying node indices provided by the shapecast function include offsets of all
				// root buffers to guarantee they're unique between roots so offset left and right indices here.
				const offsetLeft = left + byteOffset;
				const offsetRight = right + byteOffset;

				let leftChange = false;
				let forceLeft = force || terminationIndices && terminationIndices.has( offsetLeft );
				let traverseLeft = forceLeft || ( nodeIndices ? nodeIndices.has( offsetLeft ) : true );
				if ( traverseLeft ) {

					leftChange = _traverse( left, byteOffset, forceLeft );

				}

				let rightChange = false;
				let forceRight = force || terminationIndices && terminationIndices.has( offsetRight );
				let traverseRight = forceRight || ( nodeIndices ? nodeIndices.has( offsetRight ) : true );
				if ( traverseRight ) {

					rightChange = _traverse( right, byteOffset, forceRight );

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
	raycast( mesh, raycaster, ray, intersects ) {

		const geometry = this.geometry;
		for ( const root of this._roots ) {

			setBuffer( root );
			raycast( 0, mesh, geometry, raycaster, ray, intersects );
			clearBuffer();

		}

	}

	raycastFirst( mesh, raycaster, ray ) {

		const geometry = this.geometry;
		let closestResult = null;
		for ( const root of this._roots ) {

			setBuffer( root );
			const result = raycastFirst( 0, mesh, geometry, raycaster, ray );
			clearBuffer();

			if ( result != null && ( closestResult == null || result.distance < closestResult.distance ) ) {

				closestResult = result;

			}

		}

		return closestResult;

	}

	intersectsGeometry( mesh, otherGeometry, geomToMesh ) {

		const otherBvh = otherGeometry.boundsTree;
		const meshToGeom = new Matrix4().copy( geomToMesh ).invert();
		const geometry = this.geometry;

		const indexAttr = geometry.index;
		const posAttr = geometry.attributes.position;
		const otherIndexAttr = otherGeometry.index;
		const otherPosAttr = otherGeometry.attributes.position;

		if ( otherBvh ) {

			let result = false;
			let byteOffset = 0;
			for ( const root of this._roots ) {

				setBuffer( root );

				let otherByteOffset = 0;
				for ( const otherRoot of otherBvh._roots ) {

					setBuffer2( otherRoot );
					result = bvhcast(
						0, 0,

						( box1, box2, score ) => {

							return score <= 0;

						},

						( offset1, count1, offset2, count2 ) => {

							// TODO: choose the triangle with the fewest triangles to transform
							// to minimize operations.
							for ( let i2 = offset2, l2 = offset2 + count2; i2 < l2; i2 ++ ) {

								setTriangle( triangle2, i2 * 3, otherIndexAttr, otherPosAttr );
								triangle2.a.applyMatrix4( geomToMesh );
								triangle2.b.applyMatrix4( geomToMesh );
								triangle2.c.applyMatrix4( geomToMesh );
								triangle2.needsUpdate = true;

								for ( let i = offset1, l = offset1 + count1; i < l; i ++ ) {

									setTriangle( triangle, i * 3, indexAttr, posAttr );
									triangle.needsUpdate = true;

									if ( triangle.intersectsTriangle( triangle2 ) ) {

										return true;

									}

								}

							}

							return false;

						},

						( box1, box2 ) => {

							// TODO: we should prioritize the bounds that overlap more
							obb.set( box2.min, box2.max, geomToMesh );
							obb.update();
							return obb.distanceToBox( box1 );

						},

						byteOffset, 0,

						otherByteOffset, 0,

					);

					clearBuffer2();
					otherByteOffset += otherRoot.byteLength;

					if ( result ) {

						break;

					}


				}

				clearBuffer();
				byteOffset += root.byteLength;

				if ( result ) {

					break;

				}

			}

			return result;

		} else {

			// no bvh...
			// use shapecast
			if ( otherGeometry.boundingBox === null ) {

				otherGeometry.computeBoundingBox();

			}

			const otherTriCount = otherIndexAttr ? otherIndexAttr.count : posAttr.count;
			const boundingBox = otherGeometry.boundingBox;
			obb.set( boundingBox.min, boundingBox.max, geomToMesh );
			obb.update();
			return this.shapecast( null, {

				intersectsBounds: box => {

					return obb.intersectsBox( box );

				},
				intersectsRange: ( offset, count ) => {

					for ( let i = offset * 3, l = ( offset + count ) * 3; i < l; i += 3 ) {

						setTriangle( triangle, i, indexAttr, posAttr );
						triangle.a.applyMatrix4( meshToGeom );
						triangle.b.applyMatrix4( meshToGeom );
						triangle.c.applyMatrix4( meshToGeom );
						triangle.needsUpdate = true;

						for ( let i2 = 0; i2 < otherTriCount; i2 += 3 ) {

							setTriangle( triangle2, i2, otherIndexAttr, otherPosAttr );
							triangle2.needsUpdate = true;

							if ( triangle.intersectsTriangle( triangle2 ) ) {

								return true;

							}

						}

					}

				},

			} );

		}

	}

	shapecast( mesh, callbacks, _intersectsTriangleFunc, _orderNodesFunc ) {

		const geometry = this.geometry;
		if ( callbacks instanceof Function ) {

			if ( _intersectsTriangleFunc ) {

				// Support the previous function signature that provided three sequential index buffer
				// indices here.
				const originalTriangleFunc = _intersectsTriangleFunc;
				_intersectsTriangleFunc = ( tri, index, contained, depth ) => {

					const i3 = index * 3;
					return originalTriangleFunc( tri, i3, i3 + 1, i3 + 2, contained, depth );

				};


			}

			callbacks = {

				boundsTraverseOrder: _orderNodesFunc,
				intersectsBounds: callbacks,
				intersectsTriangle: _intersectsTriangleFunc,
				intersectsRange: null,

			};

			console.warn( 'MeshBVH: Shapecast function signature has changed and now takes an object of callbacks as a second argument. See docs for new signature.' );

		}

		let {
			boundsTraverseOrder,
			intersectsBounds,
			intersectsRange,
			intersectsTriangle,
		} = callbacks;

		if ( intersectsRange && intersectsTriangle ) {

			const originalIntersectsRange = intersectsRange;
			intersectsRange = ( offset, count, contained, depth, nodeIndex ) => {

				if ( ! originalIntersectsRange( offset, count, contained, depth, nodeIndex ) ) {

					return iterateOverTriangles( offset, count, geometry, intersectsTriangle, contained, depth, triangle );

				}

				return true;

			};

		} else if ( ! intersectsRange ) {

			if ( intersectsTriangle ) {

				intersectsRange = ( offset, count, contained, depth ) => {

					return iterateOverTriangles( offset, count, geometry, intersectsTriangle, contained, depth, triangle );

				};

			} else {

				intersectsRange = ( offset, count, contained ) => {

					return contained;

				};

			}

		}

		let result = false;
		let byteOffset = 0;
		for ( const root of this._roots ) {

			setBuffer( root );
			result = shapecast( 0, intersectsBounds, intersectsRange, boundsTraverseOrder, byteOffset );
			clearBuffer();

			if ( result ) {

				break;

			}

			byteOffset += root.byteLength;

		}

		return result;

	}

	/* Derived Cast Functions */
	intersectsBox( mesh, box, boxToMesh ) {

		obb.set( box.min, box.max, boxToMesh );
		obb.update();

		return this.shapecast(
			mesh,
			{
				intersectsBounds: box => obb.intersectsBox( box ),
				intersectsTriangle: tri => obb.intersectsTriangle( tri )
			}
		);

	}

	intersectsSphere( mesh, sphere ) {

		return this.shapecast(
			mesh,
			{
				intersectsBounds: box => sphere.intersectsBox( box ),
				intersectsTriangle: tri => tri.intersectsSphere( sphere )
			}
		);

	}

	closestPointToGeometry( mesh, otherGeometry, geometryToBvh, target1 = null, target2 = null, minThreshold = 0, maxThreshold = Infinity ) {

		if ( ! otherGeometry.boundingBox ) {

			otherGeometry.computeBoundingBox();

		}

		const geometry = this.geometry;
		const pos = geometry.attributes.position;
		const index = geometry.index;
		const otherPos = otherGeometry.attributes.position;
		const otherIndex = otherGeometry.index;

		let tempTarget1 = null;
		let tempTarget2 = null;
		if ( target1 ) {

			tempTarget1 = temp1;

		}

		if ( target2 ) {

			tempTarget2 = temp2;

		}

		let closestDistance = Infinity;
		if ( otherGeometry.boundsTree ) {

			for ( const root of this._roots ) {

				let byteOffset = 0;
				setBuffer( root );

				for ( const otherRoot of otherGeometry.boundsTree._roots ) {

					let otherByteOffset = 0;
					setBuffer2( otherRoot );

					bvhcast(
						0, 0,
						( box1, box2, score ) => {

							console.log( score, closestDistance );

							return score < closestDistance && score < maxThreshold;

						},
						( offset1, count1, offset2, count2 ) => {

							for ( let i2 = offset2 * 3, l2 = ( offset2 + count2 ) * 3; i2 < l2; i2 += 3 ) {

								setTriangle( triangle2, i2, otherIndex, otherPos );
								triangle2.a.applyMatrix4( geometryToBvh );
								triangle2.b.applyMatrix4( geometryToBvh );
								triangle2.c.applyMatrix4( geometryToBvh );
								triangle2.needsUpdate = true;

								for ( let i = offset1 * 3, l = ( offset1 + count1 ) * 3; i < l; i += 3 ) {

									setTriangle( triangle, i, index, pos );
									triangle.needsUpdate = true;

									const dist = triangle.distanceToTriangle( triangle2, tempTarget1, tempTarget2 );
									if ( dist < closestDistance ) {

										if ( target1 ) {

											target1.copy( tempTarget1 );

										}

										if ( target2 ) {

											target2.copy( tempTarget2 );

										}

										closestDistance = dist;

									}

									// stop traversal if we find a point that's under the given threshold
									if ( dist < minThreshold ) {

										return true;

									}

								}

							}


						},
						( box1, box2 ) => {

							obb.min.copy( box2.min );
							obb.max.copy( box2.max );
							obb.matrix.copy( geometryToBvh );
							obb.update();

							return obb.distanceToBox( box1, Math.min( closestDistance, maxThreshold ) );

						},
						byteOffset, 0,
						otherByteOffset, 0,
					);

					clearBuffer2();
					otherByteOffset += otherRoot.byteLength;

					if ( closestDistance < minThreshold ) {

						break;

					}

				}

				clearBuffer();
				byteOffset += root.byteLength;

				if ( closestDistance < minThreshold ) {

					break;

				}

			}

		} else {

			obb.set( otherGeometry.boundingBox.min, otherGeometry.boundingBox.max, geometryToBvh );
			obb.update();
			obb2.matrix.copy( geometryToBvh ).invert();
			this.shapecast(
				mesh,
				{

					boundsTraverseOrder: box => {

						return obb.distanceToBox( box, Math.min( closestDistance, maxThreshold ) );

					},

					intersectsBounds: ( box, isLeaf, score ) => {

						if ( score < closestDistance && score < maxThreshold ) {

							// if we know the triangles of this bounds will be intersected next then
							// save the bounds to use during triangle checks.
							if ( isLeaf ) {

								obb2.min.copy( box.min );
								obb2.max.copy( box.max );
								obb2.update();

							}

							return true;

						}

						return false;

					},

					intersectsRange: ( offset, count ) => {

						// If no bounds tree then we'll just check every triangle.
						const triCount = otherIndex ? otherIndex.count : otherPos.count;
						for ( let i2 = 0, l2 = triCount; i2 < l2; i2 += 3 ) {

							setTriangle( triangle2, i2, otherIndex, otherPos );
							triangle2.a.applyMatrix4( geometryToBvh );
							triangle2.b.applyMatrix4( geometryToBvh );
							triangle2.c.applyMatrix4( geometryToBvh );
							triangle2.needsUpdate = true;

							for ( let i = offset * 3, l = ( offset + count ) * 3; i < l; i += 3 ) {

								setTriangle( triangle, i, index, pos );
								triangle.needsUpdate = true;

								const dist = triangle.distanceToTriangle( triangle2, tempTarget1, tempTarget2 );
								if ( dist < closestDistance ) {

									if ( target1 ) {

										target1.copy( tempTarget1 );

									}

									if ( target2 ) {

										target2.copy( tempTarget2 );

									}

									closestDistance = dist;

								}

								// stop traversal if we find a point that's under the given threshold
								if ( dist < minThreshold ) {

									return true;

								}

							}

						}

					},

				}

			);

		}

		return closestDistance;

	}

	distanceToGeometry( mesh, geom, matrix, minThreshold, maxThreshold ) {

		return this.closestPointToGeometry( mesh, geom, matrix, null, null, minThreshold, maxThreshold );

	}

	closestPointToPoint( mesh, point, target, minThreshold = 0, maxThreshold = Infinity ) {

		// early out if under minThreshold
		// skip checking if over maxThreshold
		// set minThreshold = maxThreshold to quickly check if a point is within a threshold
		// returns Infinity if no value found
		const minThresholdSq = minThreshold * minThreshold;
		const maxThresholdSq = maxThreshold * maxThreshold;
		let closestDistanceSq = Infinity;
		this.shapecast(

			mesh,
			{

				boundsTraverseOrder: box => {

					temp.copy( point ).clamp( box.min, box.max );
					return temp.distanceToSquared( point );

				},

				intersectsBounds: ( box, isLeaf, score ) => {

					return score < closestDistanceSq && score < maxThresholdSq;

				},

				intersectsTriangle: tri => {

					tri.closestPointToPoint( point, temp );
					const distSq = point.distanceToSquared( temp );
					if ( distSq < closestDistanceSq ) {

						if ( target ) {

							target.copy( temp );

						}

						closestDistanceSq = distSq;

					}

					if ( distSq < minThresholdSq ) {

						return true;

					} else {

						return false;

					}

				},

			}

		);

		return Math.sqrt( closestDistanceSq );

	}

	distanceToPoint( mesh, point, minThreshold, maxThreshold ) {

		return this.closestPointToPoint( mesh, point, null, minThreshold, maxThreshold );

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
