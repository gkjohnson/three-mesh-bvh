import { Vector3, BufferAttribute } from 'three';
import { CENTER } from './Constants.js';
import { BYTES_PER_NODE, IS_LEAFNODE_FLAG, buildPackedTree } from './buildFunctions.js';
import { OrientedBox } from './Utils/OrientedBox.js';
import { SeparatingAxisTriangle } from './Utils/SeparatingAxisTriangle.js';
import { setTriangle } from './Utils/TriangleUtils.js';
import {
	raycastBuffer,
	raycastFirstBuffer,
	shapecastBuffer,
	intersectsGeometryBuffer,
	setBuffer,
	clearBuffer,
} from './castFunctions.js';

const SKIP_GENERATION = Symbol( 'skip tree generation' );

const obb = new OrientedBox();
const temp = new Vector3();
const tri2 = new SeparatingAxisTriangle();
const temp1 = new Vector3();
const temp2 = new Vector3();

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

			// undocumented options

			// Whether to skip generating the tree. Used for deserialization.
			[ SKIP_GENERATION ]: false

		}, options );
		options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

		this._roots = null;
		if ( ! options[ SKIP_GENERATION ] ) {

			this._roots = buildPackedTree( geo, options );

		}

	}

	refit( geometry ) {

		const indexArr = geometry.index.array;
		const posArr = geometry.attributes.position.array;
		let buffer, uint32Array, uint16Array, float32Array;
		const roots = this._roots;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			buffer = roots[ i ];
			uint32Array = new Uint32Array( buffer );
			uint16Array = new Uint16Array( buffer );
			float32Array = new Float32Array( buffer );
			_traverse( 0 );

		}
		function _traverse( node32Index ) {

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

				const leftChange = _traverse( left );
				const rightChange = _traverse( right );
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

		for ( const root of this._roots ) {

			setBuffer( root );
			raycastBuffer( 0, mesh, raycaster, ray, intersects );

		}

		clearBuffer();

	}

	raycastFirst( mesh, raycaster, ray ) {

		let closestResult = null;
		for ( const root of this._roots ) {

			setBuffer( root );
			const result = raycastFirstBuffer( 0, mesh, raycaster, ray );

			if ( result != null && ( closestResult == null || result.distance < closestResult.distance ) ) {

				closestResult = result;

			}

		}

		clearBuffer();

		return closestResult;

	}

	intersectsGeometry( mesh, geometry, geomToMesh ) {

		let result = false;
		for ( const root of this._roots ) {

			setBuffer( root );
			result = intersectsGeometryBuffer( 0, mesh, geometry, geomToMesh );

			if ( result ) {

				break;

			}

		}

		clearBuffer();

		return result;

	}

	shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc = null, orderNodesFunc = null ) {

		let result = false;
		for ( const root of this._roots ) {

			setBuffer( root );
			result = shapecastBuffer( 0, mesh, intersectsBoundsFunc, intersectsTriangleFunc, orderNodesFunc );

			if ( result ) {

				break;

			}

		}

		clearBuffer();

		return result;

	}

	/* Derived Cast Functions */
	intersectsBox( mesh, box, boxToMesh ) {

		obb.set( box.min, box.max, boxToMesh );
		obb.update();

		return this.shapecast(
			mesh,
			box => obb.intersectsBox( box ),
			tri => obb.intersectsTriangle( tri )
		);

	}

	intersectsSphere( mesh, sphere ) {

		return this.shapecast(
			mesh,
			box => sphere.intersectsBox( box ),
			tri => tri.intersectsSphere( sphere )
		);

	}

	closestPointToGeometry( mesh, geom, geometryToBvh, target1 = null, target2 = null, minThreshold = 0, maxThreshold = Infinity ) {

		if ( ! geom.boundingBox ) {

			geom.computeBoundingBox();

		}

		obb.set( geom.boundingBox.min, geom.boundingBox.max, geometryToBvh );
		obb.update();

		const pos = geom.attributes.position;
		const index = geom.index;

		let tempTarget1 = null;
		let tempTarget2 = null;
		if ( target1 ) {

			tempTarget1 = temp1;

		}

		if ( target2 ) {

			tempTarget2 = temp2;

		}

		let closestDistance = Infinity;
		this.shapecast(
			mesh,
			( box, isLeaf, score ) => score < closestDistance && score < maxThreshold,
			tri => {

				if ( tri.needsUpdate ) {

					tri.update();

				}

				const sphere1 = tri.sphere;
				for ( let i2 = 0, l2 = index.count; i2 < l2; i2 += 3 ) {

					setTriangle( tri2, i2, index, pos );
					tri2.a.applyMatrix4( geometryToBvh );
					tri2.b.applyMatrix4( geometryToBvh );
					tri2.c.applyMatrix4( geometryToBvh );
					tri2.sphere.setFromPoints( tri2.points );

					const sphere2 = tri2.sphere;
					const sphereDist = sphere2.center.distanceTo( sphere1.center ) - sphere2.radius - sphere1.radius;
					if ( sphereDist > closestDistance ) {

						continue;

					}

					tri2.update();

					const dist = tri.distanceToTriangle( tri2, tempTarget1, tempTarget2 );
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

				return false;

			},
			box => obb.distanceToBox( box, Math.min( closestDistance, maxThreshold ) )

		);

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
		let closestDistance = Infinity;
		this.shapecast(

			mesh,
			( box, isLeaf, score ) => score < closestDistance && score < maxThreshold,
			tri => {

				tri.closestPointToPoint( point, temp );
				const dist = point.distanceTo( temp );
				if ( dist < closestDistance ) {

					if ( target ) {

						target.copy( temp );

					}
					closestDistance = dist;

				}

				if ( dist < minThreshold ) {

					return true;

				} else {

					return false;

				}

			},
			box => box.distanceToPoint( point )

		);

		return closestDistance;

	}

	distanceToPoint( mesh, point, minThreshold, maxThreshold ) {

		return this.closestPointToPoint( mesh, point, null, minThreshold, maxThreshold );

	}

}
