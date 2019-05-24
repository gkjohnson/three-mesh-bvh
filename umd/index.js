(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('three')) :
	typeof define === 'function' && define.amd ? define(['exports', 'three'], factory) :
	(global = global || self, factory(global.MeshBVHLib = global.MeshBVHLib || {}, global.THREE));
}(this, function (exports, THREE) { 'use strict';

	// Ripped and modified From THREE.js Mesh raycast
	// https://github.com/mrdoob/three.js/blob/0aa87c999fe61e216c1133fba7a95772b503eddf/src/objects/Mesh.js#L115
	var vA = new THREE.Vector3();
	var vB = new THREE.Vector3();
	var vC = new THREE.Vector3();

	var uvA = new THREE.Vector2();
	var uvB = new THREE.Vector2();
	var uvC = new THREE.Vector2();

	var intersectionPoint = new THREE.Vector3();
	var intersectionPointWorld = new THREE.Vector3();

	function checkIntersection( object, material, raycaster, ray, pA, pB, pC, point ) {

		var intersect;
		if ( material.side === THREE.BackSide ) {

			intersect = ray.intersectTriangle( pC, pB, pA, true, point );

		} else {

			intersect = ray.intersectTriangle( pA, pB, pC, material.side !== THREE.DoubleSide, point );

		}

		if ( intersect === null ) return null;

		intersectionPointWorld.copy( point );
		intersectionPointWorld.applyMatrix4( object.matrixWorld );

		var distance = raycaster.ray.origin.distanceTo( intersectionPointWorld );

		if ( distance < raycaster.near || distance > raycaster.far ) return null;

		return {
			distance: distance,
			point: intersectionPointWorld.clone(),
			object: object
		};

	}

	function checkBufferGeometryIntersection( object, raycaster, ray, position, uv, a, b, c ) {

		vA.fromBufferAttribute( position, a );
		vB.fromBufferAttribute( position, b );
		vC.fromBufferAttribute( position, c );

		var intersection = checkIntersection( object, object.material, raycaster, ray, vA, vB, vC, intersectionPoint );

		if ( intersection ) {

			if ( uv ) {

				uvA.fromBufferAttribute( uv, a );
				uvB.fromBufferAttribute( uv, b );
				uvC.fromBufferAttribute( uv, c );

				intersection.uv = THREE.Triangle.getUV( intersectionPoint, vA, vB, vC, uvA, uvB, uvC, new THREE.Vector2( ) );

			}

			var normal = new THREE.Vector3();
			intersection.face = new THREE.Face3( a, b, c, THREE.Triangle.getNormal( vA, vB, vC, normal ) );
			intersection.faceIndex = a;

		}

		return intersection;

	}


	// https://github.com/mrdoob/three.js/blob/0aa87c999fe61e216c1133fba7a95772b503eddf/src/objects/Mesh.js#L258
	function intersectTri( mesh, geo, raycaster, ray, tri, intersections ) {

		const triOffset = tri * 3;
		const a = geo.index.getX( triOffset );
		const b = geo.index.getX( triOffset + 1 );
		const c = geo.index.getX( triOffset + 2 );

		const intersection = checkBufferGeometryIntersection( mesh, raycaster, ray, geo.attributes.position, geo.attributes.uv, a, b, c );

		if ( intersection ) {

			intersection.faceIndex = tri;
			if ( intersections ) intersections.push( intersection );
			return intersection;

		}

		return null;

	}

	function intersectTris( mesh, geo, raycaster, ray, offset, count, intersections ) {

		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			intersectTri( mesh, geo, raycaster, ray, i, intersections );

		}

	}

	function intersectClosestTri( mesh, geo, raycaster, ray, offset, count ) {

		let dist = Infinity;
		let res = null;
		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			const intersection = intersectTri( mesh, geo, raycaster, ray, i );
			if ( intersection && intersection.distance < dist ) {

				res = intersection;
				dist = intersection.distance;

			}

		}

		return res;

	}

	// Returns a Float32Array representing the bounds data for box.
	function boxToArray( bx ) {

		const arr = new Float32Array( 6 );

		arr[ 0 ] = bx.min.x;
		arr[ 1 ] = bx.min.y;
		arr[ 2 ] = bx.min.z;

		arr[ 3 ] = bx.max.x;
		arr[ 4 ] = bx.max.y;
		arr[ 5 ] = bx.max.z;

		return arr;

	}

	function arrayToBox( arr, target ) {

		target.min.x = arr[ 0 ];
		target.min.y = arr[ 1 ];
		target.min.z = arr[ 2 ];

		target.max.x = arr[ 3 ];
		target.max.y = arr[ 4 ];
		target.max.z = arr[ 5 ];

		return target;

	}

	function getLongestEdgeIndex( bounds ) {

		let splitDimIdx = - 1;
		let splitDist = - Infinity;

		for ( let i = 0; i < 3; i ++ ) {

			const dist = bounds[ i + 3 ] - bounds[ i ];
			if ( dist > splitDist ) {

				splitDist = dist;
				splitDimIdx = i;

			}

		}

		return splitDimIdx;

	}

	class SeparatingAxisBounds {

		constructor() {

			this.min = Infinity;
			this.max = - Infinity;

		}

		setFromPointsField( points, field ) {

			let min = Infinity;
			let max = - Infinity;
			for ( let i = 0, l = points.length; i < l; i ++ ) {

				const p = points[ i ];
				const val = p[ field ];
				min = Math.min( val, min );
				max = Math.max( val, max );

			}

			this.min = min;
			this.max = max;


		}

		setFromPoints( axis, points ) {

			let min = Infinity;
			let max = - Infinity;
			for ( let i = 0, l = points.length; i < l; i ++ ) {

				const p = points[ i ];
				const val = axis.dot( p );
				min = Math.min( val, min );
				max = Math.max( val, max );

			}

			this.min = min;
			this.max = max;

		}

		isSeparated( other ) {

			return this.min > other.max || other.min > this.max;

		}

	}

	SeparatingAxisBounds.prototype.setFromBox = ( function () {

		const p = new THREE.Vector3();
		return function setFromBox( axis, box ) {

			const boxMin = box.min;
			const boxMax = box.max;
			let min = Infinity;
			let max = - Infinity;
			for ( let x = 0; x <= 1; x ++ ) {

				for ( let y = 0; y <= 1; y ++ ) {

					for ( let z = 0; z <= 1; z ++ ) {

						p.x = boxMin.x * x + boxMax.x * ( 1 - x );
						p.y = boxMin.y * y + boxMax.y * ( 1 - y );
						p.z = boxMin.z * z + boxMax.z * ( 1 - z );

						const val = axis.dot( p );
						min = Math.min( val, min );
						max = Math.max( val, max );

					}

				}

			}

			this.min = min;
			this.max = max;

		};

	} )();

	const areIntersecting = ( function () {

		const cacheSatBounds = new SeparatingAxisBounds();
		return function areIntersecting( shape1, shape2 ) {

			const points1 = shape1.points;
			const satAxes1 = shape1.satAxes;
			const satBounds1 = shape1.satBounds;

			const points2 = shape2.points;
			const satAxes2 = shape2.satAxes;
			const satBounds2 = shape2.satBounds;

			// check axes of the first shape
			for ( let i = 0; i < 3; i ++ ) {

				const sb = satBounds1[ i ];
				const sa = satAxes1[ i ];
				cacheSatBounds.setFromPoints( sa, points2 );
				if ( sb.isSeparated( cacheSatBounds ) ) return false;

			}

			// check axes of the second shape
			for ( let i = 0; i < 3; i ++ ) {

				const sb = satBounds2[ i ];
				const sa = satAxes2[ i ];
				cacheSatBounds.setFromPoints( sa, points1 );
				if ( sb.isSeparated( cacheSatBounds ) ) return false;

			}

		};

	} )();

	const closestPointLineToLine = ( function () {

		// https://github.com/juj/MathGeoLib/blob/master/src/Geometry/Line.cpp#L56
		const dir1 = new THREE.Vector3();
		const dir2 = new THREE.Vector3();
		const v02 = new THREE.Vector3();
		return function closestPointLineToLine( l1, l2, result ) {

			const v0 = l1.start;
			const v10 = dir1;
			const v2 = l2.start;
			const v32 = dir2;

			v02.subVectors( v0, v2 );
			dir1.subVectors( l1.end, l2.start );
			dir2.subVectors( l2.end, l2.start );

			// float d0232 = v02.Dot(v32);
			const d0232 = v02.dot( v32 );

			// float d3210 = v32.Dot(v10);
			const d3210 = v32.dot( v10 );

			// float d3232 = v32.Dot(v32);
			const d3232 = v32.dot( v32 );

			// float d0210 = v02.Dot(v10);
			const d0210 = v02.dot( v10 );

			// float d1010 = v10.Dot(v10);
			const d1010 = v10.dot( v10 );

			// float denom = d1010*d3232 - d3210*d3210;
			const denom = d1010 * d3232 - d3210 * d3210;

			let d, d2;
			if ( denom !== 0 ) {

				d = ( d0232 * d3210 - d0210 * d3232 ) / denom;

			} else {

				d = 0;

			}

			d2 = ( d0232 + d * d3210 ) / d3232;

			result.x = d;
			result.y = d2;

		};

	} )();

	const closestPointsSegmentToSegment = ( function () {

		// https://github.com/juj/MathGeoLib/blob/master/src/Geometry/LineSegment.cpp#L187
		const paramResult = new THREE.Vector2();
		const temp1 = new THREE.Vector3();
		const temp2 = new THREE.Vector3();
		return function closestPointsSegmentToSegment( l1, l2, target1, target2 ) {

			closestPointLineToLine( l1, l2, paramResult );

			let d = paramResult.x;
			let d2 = paramResult.y;
			if ( d >= 0 && d <= 1 && d2 >= 0 && d2 <= 1 ) {

				l1.at( d, target1 );
				l2.at( d2, target2 );

				return;

			} else if ( d >= 0 && d <= 1 ) {

				// Only d2 is out of bounds.
				if ( d2 < 0 ) {

					l2.at( 0, target2 );

				} else {

					l2.at( 1, target2 );

				}

				l1.closestPointToPoint( target2, true, target1 );
				return;

			} else if ( d2 >= 0 && d2 <= 1 ) {

				// Only d is out of bounds.
				if ( d < 0 ) {

					l1.at( 0, target1 );

				} else {

					l1.at( 1, target1 );

				}

				l2.closestPointToPoint( target1, true, target2 );
				return;

			} else {

				// Both u and u2 are out of bounds.
				let p;
				if ( d < 0 ) {

					p = l1.start;

				} else {

					p = l1.end;

				}

				let p2;
				if ( d2 < 0 ) {

					p2 = l2.start;

				} else {

					p2 = l2.end;

				}

				const closestPoint = temp1;
				const closestPoint2 = temp2;
				l1.closestPointToPoint( p2, true, temp1 );
				l2.closestPointToPoint( p, true, temp2 );

				if ( closestPoint.distanceToSquared( p2 ) <= closestPoint2.distanceToSquared( p ) ) {

					target1.copy( closestPoint );
					target2.copy( p2 );
					return;

				} else {

					target1.copy( p );
					target2.copy( closestPoint2 );
					return;

				}

			}

		};

	} )();


	const sphereIntersectTriangle = ( function () {

		// https://stackoverflow.com/questions/34043955/detect-collision-between-sphere-and-triangle-in-three-js
		const closestPointTemp = new THREE.Vector3();
		const projectedPointTemp = new THREE.Vector3();
		const planeTemp = new THREE.Plane();
		const lineTemp = new THREE.Line3();
		return function sphereIntersectTriangle( sphere, triangle ) {

			const { radius, center } = sphere;
			const { a, b, c } = triangle;

			// phase 1
			lineTemp.start = a;
			lineTemp.end = b;
			const closestPoint1 = lineTemp.closestPointToPoint( center, true, closestPointTemp );
			if ( closestPoint1.distanceTo( center ) <= radius ) return true;

			lineTemp.start = a;
			lineTemp.end = c;
			const closestPoint2 = lineTemp.closestPointToPoint( center, true, closestPointTemp );
			if ( closestPoint2.distanceTo( center ) <= radius ) return true;

			lineTemp.start = b;
			lineTemp.end = c;
			const closestPoint3 = lineTemp.closestPointToPoint( center, true, closestPointTemp );
			if ( closestPoint3.distanceTo( center ) <= radius ) return true;

			// phase 2
			const plane = triangle.getPlane( planeTemp );
			const dp = Math.abs( plane.distanceToPoint( center ) );
			if ( dp <= radius ) {

				const pp = plane.projectPoint( center, projectedPointTemp );
				const cp = triangle.containsPoint( pp );
				if ( cp ) return true;

			}

			return false;

		};

	} )();

	class SeparatingAxisTriangle extends THREE.Triangle {

		constructor( ...args ) {

			super( ...args );

			this.isSeparatingAxisTriangle = true;
			this.satAxes = new Array( 4 ).fill().map( () => new THREE.Vector3() );
			this.satBounds = new Array( 4 ).fill().map( () => new SeparatingAxisBounds() );
			this.points = [ this.a, this.b, this.c ];
			this.sphere = new THREE.Sphere();

		}

	}

	SeparatingAxisTriangle.prototype.update = ( function () {

		const arr = new Array( 3 );
		return function update( ) {

			const a = this.a;
			const b = this.b;
			const c = this.c;

			arr[ 0 ] = this.a;
			arr[ 1 ] = this.b;
			arr[ 2 ] = this.c;

			const satAxes = this.satAxes;
			const satBounds = this.satBounds;

			const axis0 = satAxes[ 0 ];
			const sab0 = satBounds[ 0 ];
			this.getNormal( axis0 );
			sab0.setFromPoints( axis0, arr );

			const axis1 = satAxes[ 1 ];
			const sab1 = satBounds[ 1 ];
			axis1.subVectors( a, b );
			sab1.setFromPoints( axis1, arr );

			const axis2 = satAxes[ 2 ];
			const sab2 = satBounds[ 2 ];
			axis2.subVectors( b, c );
			sab2.setFromPoints( axis2, arr );

			const axis3 = satAxes[ 3 ];
			const sab3 = satBounds[ 3 ];
			axis3.subVectors( c, a );
			sab3.setFromPoints( axis3, arr );

			this.sphere.setFromPoints( this.points );

		};

	} )();

	SeparatingAxisTriangle.prototype.intersectsTriangle = ( function () {

		const saTri2 = new SeparatingAxisTriangle();
		const arr1 = new Array( 3 );
		const arr2 = new Array( 3 );
		const cachedSatBounds = new SeparatingAxisBounds();
		const cachedSatBounds2 = new SeparatingAxisBounds();
		const cachedAxis = new THREE.Vector3();
		return function intersectsTriangle( other ) {

			if ( ! other.isSeparatingAxisTriangle ) {

				saTri2.copy( other );
				saTri2.update();
				other = saTri2;

			}

			const satBounds1 = this.satBounds;
			const satAxes1 = this.satAxes;
			arr2[ 0 ] = other.a;
			arr2[ 1 ] = other.b;
			arr2[ 2 ] = other.c;
			for ( let i = 0; i < 4; i ++ ) {

				const sb = satBounds1[ i ];
				const sa = satAxes1[ i ];
				cachedSatBounds.setFromPoints( sa, arr2 );
				if ( sb.isSeparated( cachedSatBounds ) ) return false;

			}

			const satBounds2 = other.satBounds;
			const satAxes2 = other.satAxes;
			arr1[ 0 ] = this.a;
			arr1[ 1 ] = this.b;
			arr1[ 2 ] = this.c;
			for ( let i = 0; i < 4; i ++ ) {

				const sb = satBounds2[ i ];
				const sa = satAxes2[ i ];
				cachedSatBounds.setFromPoints( sa, arr1 );
				if ( sb.isSeparated( cachedSatBounds ) ) return false;

			}

			// check crossed axes
			for ( let i = 0; i < 4; i ++ ) {

				const sa1 = satAxes1[ i ];
				for ( let i2 = 0; i2 < 4; i2 ++ ) {

					const sa2 = satAxes2[ i2 ];
					cachedAxis.crossVectors( sa1, sa2 );
					cachedSatBounds.setFromPoints( cachedAxis, arr1 );
					cachedSatBounds2.setFromPoints( cachedAxis, arr2 );
					if ( cachedSatBounds.isSeparated( cachedSatBounds2 ) ) return false;

				}

			}

			return true;

		};

	} )();


	SeparatingAxisTriangle.prototype.distanceToPoint = ( function () {

		const target = new THREE.Vector3();
		return function distanceToPoint( point ) {

			this.closestPointToPoint( point, target );
			return point.distanceTo( target );

		};

	} )();


	SeparatingAxisTriangle.prototype.distanceToTriangle = ( function () {

		const point = new THREE.Vector3();
		const point2 = new THREE.Vector3();
		const cornerFields = [ 'a', 'b', 'c' ];
		const line1 = new THREE.Line3();
		const line2 = new THREE.Line3();

		return function distanceToTriangle( other, target1 = null, target2 = null ) {

			if ( this.intersectsTriangle( other ) ) {

				// TODO: This will not result in a point that lies on
				// the intersection line of the triangles
				if ( target1 || target2 ) {

					this.getMidpoint( point );
					other.closestPointToPoint( point, point2 );
					this.closestPointToPoint( point2, point );

					if ( target1 ) target1.copy( point );
					if ( target2 ) target2.copy( point2 );

				}

				return 0;

			}

			let closestDistanceSq = Infinity;

			// check all point distances
			for ( let i = 0; i < 3; i ++ ) {

				let dist;
				const field = cornerFields[ i ];
				const otherVec = other[ field ];
				this.closestPointToPoint( otherVec, point );

				dist = otherVec.distanceToSquared( point );

				if ( dist < closestDistanceSq ) {

					closestDistanceSq = dist;
					if ( target1 ) target1.copy( point );
					if ( target2 ) target2.copy( otherVec );

				}


				const thisVec = this[ field ];
				other.closestPointToPoint( thisVec, point );

				dist = thisVec.distanceToSquared( point );

				if ( dist < closestDistanceSq ) {

					closestDistanceSq = dist;
					if ( target1 ) target1.copy( thisVec );
					if ( target2 ) target2.copy( point );

				}

			}

			for ( let i = 0; i < 3; i ++ ) {

				const f11 = cornerFields[ i ];
				const f12 = cornerFields[ ( i + 1 ) % 3 ];
				line1.set( this[ f11 ], this[ f12 ] );
				for ( let i2 = 0; i2 < 3; i2 ++ ) {

					const f21 = cornerFields[ i2 ];
					const f22 = cornerFields[ ( i2 + 1 ) % 3 ];
					line2.set( other[ f21 ], other[ f22 ] );

					closestPointsSegmentToSegment( line1, line2, point, point2 );

					const dist = point.distanceToSquared( point2 );
					if ( dist < closestDistanceSq ) {

						closestDistanceSq = dist;
						if ( target1 ) target1.copy( point );
						if ( target2 ) target2.copy( point2 );

					}

				}

			}

			return Math.sqrt( closestDistanceSq );

		};

	} )();

	class OrientedBox extends THREE.Box3 {

		constructor( ...args ) {

			super( ...args );

			this.isOrientedBox = true;
			this.matrix = new THREE.Matrix4();
			this.invMatrix = new THREE.Matrix4();
			this.points = new Array( 8 ).fill().map( () => new THREE.Vector3() );
			this.satAxes = new Array( 3 ).fill().map( () => new THREE.Vector3() );
			this.satBounds = new Array( 3 ).fill().map( () => new SeparatingAxisBounds() );
			this.alignedSatBounds = new Array( 3 ).fill().map( () => new SeparatingAxisBounds() );
			this.sphere = new THREE.Sphere();

		}

		set( min, max, matrix ) {

			super.set( min, max );
			this.matrix = matrix;

		}

		copy( other ) {

			super.copy( other );
			this.matrix.copy( other.matrix );

		}

	}

	OrientedBox.prototype.update = ( function () {

		return function update() {

			const matrix = this.matrix;
			const min = this.min;
			const max = this.max;

			const points = this.points;
			for ( let x = 0; x <= 1; x ++ ) {

				for ( let y = 0; y <= 1; y ++ ) {

					for ( let z = 0; z <= 1; z ++ ) {

						const i = ( ( 1 << 0 ) * x ) | ( ( 1 << 1 ) * y ) | ( ( 1 << 2 ) * z );
						const v = points[ i ];
						v.x = x ? max.x : min.x;
						v.y = y ? max.y : min.y;
						v.z = z ? max.z : min.z;

						v.applyMatrix4( matrix );

					}

				}

			}

			this.sphere.setFromPoints( this.points );

			const satBounds = this.satBounds;
			const satAxes = this.satAxes;
			const minVec = points[ 0 ];
			for ( let i = 0; i < 3; i ++ ) {

				const axis = satAxes[ i ];
				const sb = satBounds[ i ];
				const index = 1 << i;
				const pi = points[ index ];

				axis.subVectors( minVec, pi );
				sb.setFromPoints( axis, points );

			}

			const alignedSatBounds = this.alignedSatBounds;
			alignedSatBounds[ 0 ].setFromPointsField( points, 'x' );
			alignedSatBounds[ 1 ].setFromPointsField( points, 'y' );
			alignedSatBounds[ 2 ].setFromPointsField( points, 'z' );

			this.invMatrix.getInverse( this.matrix );

		};

	} )();

	OrientedBox.prototype.intersectsBox = ( function () {

		const aabbBounds = new SeparatingAxisBounds();
		return function intersectsBox( box ) {

			if ( ! box.intersectsSphere( this.sphere ) ) return false;

			const min = box.min;
			const max = box.max;
			const satBounds = this.satBounds;
			const satAxes = this.satAxes;
			const alignedSatBounds = this.alignedSatBounds;

			aabbBounds.min = min.x;
			aabbBounds.max = max.x;
			if ( alignedSatBounds[ 0 ].isSeparated( aabbBounds ) ) return false;

			aabbBounds.min = min.y;
			aabbBounds.max = max.y;
			if ( alignedSatBounds[ 1 ].isSeparated( aabbBounds ) ) return false;

			aabbBounds.min = min.z;
			aabbBounds.max = max.z;
			if ( alignedSatBounds[ 2 ].isSeparated( aabbBounds ) ) return false;

			for ( let i = 0; i < 3; i ++ ) {

				const axis = satAxes[ i ];
				const sb = satBounds[ i ];
				aabbBounds.setFromBox( axis, box );
				if ( sb.isSeparated( aabbBounds ) ) return false;

			}

			return true;

		};

	} )();

	OrientedBox.prototype.intersectsTriangle = ( function () {

		const saTri = new SeparatingAxisTriangle();
		const pointsArr = new Array( 3 );
		const cachedSatBounds = new SeparatingAxisBounds();
		const cachedSatBounds2 = new SeparatingAxisBounds();
		const cachedAxis = new THREE.Vector3();
		return function intersectsTriangle( triangle ) {

			if ( ! triangle.isSeparatingAxisTriangle ) {

				saTri.copy( triangle );
				saTri.update();
				triangle = saTri;

			}

			const satBounds = this.satBounds;
			const satAxes = this.satAxes;

			pointsArr[ 0 ] = triangle.a;
			pointsArr[ 1 ] = triangle.b;
			pointsArr[ 2 ] = triangle.c;

			for ( let i = 0; i < 3; i ++ ) {

				const sb = satBounds[ i ];
				const sa = satAxes[ i ];
				cachedSatBounds.setFromPoints( sa, pointsArr );
				if ( sb.isSeparated( cachedSatBounds ) ) return false;

			}

			const triSatBounds = triangle.satBounds;
			const triSatAxes = triangle.satAxes;
			const points = this.points;
			for ( let i = 0; i < 3; i ++ ) {

				const sb = triSatBounds[ i ];
				const sa = triSatAxes[ i ];
				cachedSatBounds.setFromPoints( sa, points );
				if ( sb.isSeparated( cachedSatBounds ) ) return false;

			}

			// check crossed axes
			for ( let i = 0; i < 3; i ++ ) {

				const sa1 = satAxes[ i ];
				for ( let i2 = 0; i2 < 4; i2 ++ ) {

					const sa2 = triSatAxes[ i2 ];
					cachedAxis.crossVectors( sa1, sa2 );
					cachedSatBounds.setFromPoints( cachedAxis, pointsArr );
					cachedSatBounds2.setFromPoints( cachedAxis, points );
					if ( cachedSatBounds.isSeparated( cachedSatBounds2 ) ) return false;

				}

			}

			return true;

		};

	} )();

	OrientedBox.prototype.closestPointToPoint = ( function () {

		return function closestPointToPoint( point, target1 ) {

			target1
				.copy( point )
				.applyMatrix4( this.invMatrix )
				.clamp( this.min, this.max )
				.applyMatrix4( this.matrix );

			return target1;

		};

	} )();

	OrientedBox.prototype.distanceToPoint = ( function () {

		const target = new THREE.Vector3();
		return function distanceToPoint( point ) {

			this.closestPointToPoint( point, target );
			return point.distanceTo( target );

		};

	} )();


	OrientedBox.prototype.distanceToBox = ( function () {

		const xyzFields = [ 'x', 'y', 'z' ];
		const segments1 = new Array( 12 ).fill().map( () => new THREE.Line3() );
		const segments2 = new Array( 12 ).fill().map( () => new THREE.Line3() );

		const point1 = new THREE.Vector3();
		const point2 = new THREE.Vector3();

		return function distanceToBox( box, threshold = 0, target1 = null, target2 = null ) {

			if ( this.intersectsBox( box ) ) {

				if ( target1 || target2 ) {

					box.getCenter( point2 );
					this.closestPointToPoint( point2, point1 );
					box.closestPointToPoint( point1, point2 );

					if ( target1 ) target1.copy( point1 );
					if ( target2 ) target2.copy( point2 );

				}
				return 0;

			}

			const threshold2 = threshold * threshold;
			const min = box.min;
			const max = box.max;
			const points = this.points;


			// iterate over every edge and compare distances
			let closestDistanceSq = Infinity;

			// check over all these points
			for ( let i = 0; i < 8; i ++ ) {

				const p = points[ i ];
				point2.copy( p ).clamp( min, max );

				const dist = p.distanceToSquared( point2 );
				if ( dist < closestDistanceSq ) {

					closestDistanceSq = dist;
					if ( target1 ) target1.copy( p );
					if ( target2 ) target2.copy( point2 );

					if ( dist < threshold2 ) return Math.sqrt( dist );

				}

			}

			// generate and check all line segment distances
			let count = 0;
			for ( let i = 0; i < 3; i ++ ) {

				for ( let i1 = 0; i1 <= 1; i1 ++ ) {

					for ( let i2 = 0; i2 <= 1; i2 ++ ) {

						const nextIndex = ( i + 1 ) % 3;
						const nextIndex2 = ( i + 2 ) % 3;

						// get obb line segments
						const index = i1 << nextIndex | i2 << nextIndex2;
						const index2 = 1 << i | i1 << nextIndex | i2 << nextIndex2;
						const p1 = points[ index ];
						const p2 = points[ index2 ];
						const line1 = segments1[ count ];
						line1.set( p1, p2 );


						// get aabb line segments
						const f1 = xyzFields[ i ];
						const f2 = xyzFields[ nextIndex ];
						const f3 = xyzFields[ nextIndex2 ];
						const line2 = segments2[ count ];
						const start = line2.start;
						const end = line2.end;

						start[ f1 ] = min[ f1 ];
						start[ f2 ] = i1 ? min[ f2 ] : max[ f2 ];
						start[ f3 ] = i2 ? min[ f3 ] : max[ f2 ];

						end[ f1 ] = max[ f1 ];
						end[ f2 ] = i1 ? min[ f2 ] : max[ f2 ];
						end[ f3 ] = i2 ? min[ f3 ] : max[ f2 ];

						count ++;

					}

				}

			}

			// check all the other boxes point
			for ( let x = 0; x <= 1; x ++ ) {

				for ( let y = 0; y <= 1; y ++ ) {

					for ( let z = 0; z <= 1; z ++ ) {

						point2.x = x ? max.x : min.x;
						point2.y = y ? max.y : min.y;
						point2.z = z ? max.z : min.z;

						this.closestPointToPoint( point2, point1 );
						const dist = point2.distanceToSquared( point1 );
						if ( dist < closestDistanceSq ) {

							closestDistanceSq = dist;
							if ( target1 ) target1.copy( point1 );
							if ( target2 ) target2.copy( point2 );

							if ( dist < threshold2 ) return Math.sqrt( dist );

						}

					}

				}

			}

			for ( let i = 0; i < 12; i ++ ) {

				const l1 = segments1[ i ];
				for ( let i2 = 0; i2 < 12; i2 ++ ) {

					const l2 = segments2[ i2 ];
					closestPointsSegmentToSegment( l1, l2, point1, point2 );
					const dist = point1.distanceToSquared( point2 );
					if ( dist < closestDistanceSq ) {

						closestDistanceSq = dist;
						if ( target1 ) target1.copy( point1 );
						if ( target2 ) target2.copy( point2 );

						if ( dist < threshold2 ) return Math.sqrt( dist );

					}

				}

			}

			return Math.sqrt( closestDistanceSq );

		};

	} )();

	const boundingBox = new THREE.Box3();
	const boxIntersection = new THREE.Vector3();
	const xyzFields = [ 'x', 'y', 'z' ];

	function setTriangle( tri, i, index, pos ) {

		const ta = tri.a;
		const tb = tri.b;
		const tc = tri.c;

		let i3 = index.getX( i );
		ta.x = pos.getX( i3 );
		ta.y = pos.getY( i3 );
		ta.z = pos.getZ( i3 );

		i3 = index.getX( i + 1 );
		tb.x = pos.getX( i3 );
		tb.y = pos.getY( i3 );
		tb.z = pos.getZ( i3 );

		i3 = index.getX( i + 2 );
		tc.x = pos.getX( i3 );
		tc.y = pos.getY( i3 );
		tc.z = pos.getZ( i3 );

	}

	class MeshBVHNode {

		constructor() {

			// internal nodes have boundingData, left, right, and splitAxis
			// leaf nodes have offset and count (referring to primitives in the mesh geometry)

		}

		intersectRay( ray, target ) {

			arrayToBox( this.boundingData, boundingBox );

			return ray.intersectBox( boundingBox, target );

		}

		raycast( mesh, raycaster, ray, intersects ) {

			if ( this.count ) intersectTris( mesh, mesh.geometry, raycaster, ray, this.offset, this.count, intersects );
			else {

				if ( this.left.intersectRay( ray, boxIntersection ) )
					this.left.raycast( mesh, raycaster, ray, intersects );
				if ( this.right.intersectRay( ray, boxIntersection ) )
					this.right.raycast( mesh, raycaster, ray, intersects );

			}

		}

		raycastFirst( mesh, raycaster, ray ) {

			if ( this.count ) {

				return intersectClosestTri( mesh, mesh.geometry, raycaster, ray, this.offset, this.count );

			} else {


				// consider the position of the split plane with respect to the oncoming ray; whichever direction
				// the ray is coming from, look for an intersection among that side of the tree first
				const splitAxis = this.splitAxis;
				const xyzAxis = xyzFields[ splitAxis ];
				const rayDir = ray.direction[ xyzAxis ];
				const leftToRight = rayDir >= 0;

				// c1 is the child to check first
				let c1, c2;
				if ( leftToRight ) {

					c1 = this.left;
					c2 = this.right;

				} else {

					c1 = this.right;
					c2 = this.left;

				}

				const c1Intersection = c1.intersectRay( ray, boxIntersection );
				const c1Result = c1Intersection ? c1.raycastFirst( mesh, raycaster, ray ) : null;

				// if we got an intersection in the first node and it's closer than the second node's bounding
				// box, we don't need to consider the second node because it couldn't possibly be a better result
				if ( c1Result ) {

					// check only along the split axis
					const rayOrig = ray.origin[ xyzAxis ];
					const toPoint = rayOrig - c1Result.point[ xyzAxis ];
					const toChild1 = rayOrig - c2.boundingData[ splitAxis ];
					const toChild2 = rayOrig - c2.boundingData[ splitAxis + 3 ];

					const toPointSq = toPoint * toPoint;
					if ( toPointSq <= toChild1 * toChild1 && toPointSq <= toChild2 * toChild2 ) {

						return c1Result;

					}

				}

				// either there was no intersection in the first node, or there could still be a closer
				// intersection in the second, so check the second node and then take the better of the two
				const c2Intersection = c2.intersectRay( ray, boxIntersection );
				const c2Result = c2Intersection ? c2.raycastFirst( mesh, raycaster, ray ) : null;

				if ( c1Result && c2Result ) {

					return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

				} else {

					return c1Result || c2Result || null;

				}

			}

		}

	}

	MeshBVHNode.prototype.shapecast = ( function () {

		const triangle = new SeparatingAxisTriangle();
		const cachedBox1 = new THREE.Box3();
		const cachedBox2 = new THREE.Box3();
		return function shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc = null, nodeScoreFunc = null ) {

			if ( this.count && intersectsTriangleFunc ) {

				const geometry = mesh.geometry;
				const index = geometry.index;
				const pos = geometry.attributes.position;
				const offset = this.offset;
				const count = this.count;

				for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

					setTriangle( triangle, i, index, pos );
					triangle.update();

					if ( intersectsTriangleFunc( triangle, i, i + 1, i + 2 ) ) {

						return true;

					}

				}

				return false;

			} else {

				const left = this.left;
				const right = this.right;
				let c1 = left;
				let c2 = right;

				let score1, score2;
				let box1, box2;
				if ( nodeScoreFunc ) {

					box1 = cachedBox1;
					box2 = cachedBox2;

					arrayToBox( c1.boundingData, box1 );
					arrayToBox( c2.boundingData, box2 );

					score1 = nodeScoreFunc( box1 );
					score2 = nodeScoreFunc( box2 );

					if ( score2 < score1 ) {

						c1 = right;
						c2 = left;

						const temp = score1;
						score1 = score2;
						score2 = temp;

						const tempBox = box1;
						box1 = box2;
						box2 = tempBox;

					}

				}

				if ( ! box1 ) {

					box1 = cachedBox1;
					arrayToBox( c1.boundingData, box1 );

				}

				const isC1Leaf = ! ! c1.count;
				const c1Intersection =
					intersectsBoundsFunc( box1, isC1Leaf, score1, c1 ) &&
					c1.shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc, nodeScoreFunc );

				if ( c1Intersection ) return true;


				if ( ! box2 ) {

					box2 = cachedBox2;
					arrayToBox( c2.boundingData, box2 );

				}

				const isC2Leaf = ! ! c2.count;
				const c2Intersection =
					intersectsBoundsFunc( box2, isC2Leaf, score2, c2 ) &&
					c2.shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc, nodeScoreFunc );

				if ( c2Intersection ) return true;

				return false;

			}

		};

	} )();

	MeshBVHNode.prototype.intersectsGeometry = ( function () {

		const triangle = new SeparatingAxisTriangle();
		const triangle2 = new SeparatingAxisTriangle();
		const cachedMesh = new THREE.Mesh();
		const invertedMat = new THREE.Matrix4();

		const obb = new OrientedBox();
		const obb2 = new OrientedBox();

		return function intersectsGeometry( mesh, geometry, geometryToBvh, cachedObb = null ) {

			if ( cachedObb === null ) {

				if ( ! geometry.boundingBox ) {

					geometry.computeBoundingBox();

				}

				obb.set( geometry.boundingBox.min, geometry.boundingBox.max, geometryToBvh );
				obb.update();
				cachedObb = obb;

			}

			if ( this.count ) {

				const thisGeometry = mesh.geometry;
				const thisIndex = thisGeometry.index;
				const thisPos = thisGeometry.attributes.position;

				const index = geometry.index;
				const pos = geometry.attributes.position;

				const offset = this.offset;
				const count = this.count;

				// get the inverse of the geometry matrix so we can transform our triangles into the
				// geometry space we're trying to test. We assume there are fewer triangles being checked
				// here.
				invertedMat.getInverse( geometryToBvh );

				if ( geometry.boundsTree ) {

					function triangleCallback( tri ) {

						tri.a.applyMatrix4( geometryToBvh );
						tri.b.applyMatrix4( geometryToBvh );
						tri.c.applyMatrix4( geometryToBvh );
						tri.update();

						for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

							// this triangle needs to be transformed into the current BVH coordinate frame
							setTriangle( triangle2, i, thisIndex, thisPos );
							triangle2.update();
							if ( tri.intersectsTriangle( triangle2 ) ) {

								return true;

							}

						}

						return false;

					}

					arrayToBox( this.boundingData, obb2 );
					obb2.matrix.copy( invertedMat );
					obb2.update();

					cachedMesh.geometry = geometry;
					const res = geometry.boundsTree.shapecast( cachedMesh, box => obb2.intersectsBox( box ), triangleCallback );
					cachedMesh.geometry = null;

					return res;

				} else {

					for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

						// this triangle needs to be transformed into the current BVH coordinate frame
						setTriangle( triangle, i, thisIndex, thisPos );
						triangle.a.applyMatrix4( invertedMat );
						triangle.b.applyMatrix4( invertedMat );
						triangle.c.applyMatrix4( invertedMat );
						triangle.update();

						for ( let i2 = 0, l2 = index.count; i2 < l2; i2 += 3 ) {

							setTriangle( triangle2, i2, index, pos );
							triangle2.update();

							if ( triangle.intersectsTriangle( triangle2 ) ) {

								return true;

							}

						}

					}

				}

			} else {

				const left = this.left;
				const right = this.right;

				arrayToBox( left.boundingData, boundingBox );
				const leftIntersection =
					cachedObb.intersectsBox( boundingBox ) &&
					left.intersectsGeometry( mesh, geometry, geometryToBvh, cachedObb );

				if ( leftIntersection ) return true;


				arrayToBox( right.boundingData, boundingBox );
				const rightIntersection =
					cachedObb.intersectsBox( boundingBox ) &&
					right.intersectsGeometry( mesh, geometry, geometryToBvh, cachedObb );

				if ( rightIntersection ) return true;

				return false;

			}

		};

	} )();

	MeshBVHNode.prototype.intersectsBox = ( function () {

		const obb = new OrientedBox();

		return function intersectsBox( mesh, box, boxToBvh ) {

			obb.set( box.min, box.max, boxToBvh );
			obb.update();

			return this.shapecast(
				mesh,
				box => obb.intersectsBox( box ),
				tri => obb.intersectsTriangle( tri )
			);

		};

	} )();

	MeshBVHNode.prototype.intersectsSphere = ( function () {

		return function intersectsSphere( mesh, sphere ) {

			return this.shapecast(
				mesh,
				box => sphere.intersectsBox( box ),
				tri => sphereIntersectTriangle( sphere, tri )
			);

		};

	} )();

	MeshBVHNode.prototype.closestPointToPoint = ( function () {

		// early out if under minThreshold
		// skip checking if over maxThreshold
		// set minThreshold = maxThreshold to quickly check if a point is within a threshold
		// returns Infinity if no value found

		const temp = new THREE.Vector3();
		return function closestPointToPoint( mesh, point, target = null, minThreshold = 0, maxThreshold = Infinity ) {

			let closestDistance = Infinity;
			this.shapecast(

				mesh,
				( box, isLeaf, score ) => score < closestDistance && score < maxThreshold,
				tri => {

					tri.closestPointToPoint( point, temp );
					const dist = point.distanceTo( temp );
					if ( dist < closestDistance ) {

						if ( target ) target.copy( temp );
						closestDistance = dist;

					}
					if ( dist < minThreshold ) return true;
					return false;

				},
				box => box.distanceToPoint( point )

			);

			return closestDistance;

		};

	} )();

	MeshBVHNode.prototype.closestPointToGeometry = ( function () {

		// early out if under minThreshold
		// skip checking if over maxThreshold
		// set minThreshold = maxThreshold to quickly check if a point is within a threshold
		// returns Infinity if no value found

		const tri2 = new SeparatingAxisTriangle();
		const obb = new OrientedBox();

		const temp1 = new THREE.Vector3();
		const temp2 = new THREE.Vector3();
		return function closestPointToGeometry( mesh, geometry, geometryToBvh, target1 = null, target2 = null, minThreshold = 0, maxThreshold = Infinity ) {

			if ( ! geometry.boundingBox ) geometry.computeBoundingBox();
			obb.set( geometry.boundingBox.min, geometry.boundingBox.max, geometryToBvh );
			obb.update();

			const pos = geometry.attributes.position;
			const index = geometry.index;

			let tempTarget1, tempTarget2;
			if ( target1 ) tempTarget1 = temp1;
			if ( target2 ) tempTarget2 = temp2;

			let closestDistance = Infinity;
			this.shapecast(
				mesh,
				( box, isLeaf, score ) => score < closestDistance && score < maxThreshold,
				tri => {

					const sphere1 = tri.sphere;
					for ( let i2 = 0, l2 = index.count; i2 < l2; i2 += 3 ) {

						setTriangle( tri2, i2, index, pos );
						tri2.a.applyMatrix4( geometryToBvh );
						tri2.b.applyMatrix4( geometryToBvh );
						tri2.c.applyMatrix4( geometryToBvh );
						tri2.sphere.setFromPoints( tri2.points );

						const sphere2 = tri2.sphere;
						const sphereDist = sphere2.center.distanceTo( sphere1.center ) - sphere2.radius - sphere1.radius;
						if ( sphereDist > closestDistance ) continue;

						tri2.update();

						const dist = tri.distanceToTriangle( tri2, tempTarget1, tempTarget2 );
						if ( dist < closestDistance ) {

							if ( target1 ) target1.copy( tempTarget1 );
							if ( target2 ) target2.copy( tempTarget2 );
							closestDistance = dist;

						}
						if ( dist < minThreshold ) return true;

					}

					return false;

				},
				box => obb.distanceToBox( box, Math.min( closestDistance, maxThreshold ) )

			);

			return closestDistance;

		};

	} )();

	// Split strategy constants
	const CENTER = 0;
	const AVERAGE = 1;
	const SAH = 2;

	const xyzFields$1 = [ 'x', 'y', 'z' ];

	// precomputes the bounding box for each triangle; required for quickly calculating tree splits.
	// result is an array of size tris.length * 6 where triangle i maps to a
	// [x_center, x_delta, y_center, y_delta, z_center, z_delta] tuple starting at index i * 6,
	// representing the center and half-extent in each dimension of triangle i
	function computeBounds( geo ) {

		const verts = geo.attributes.position.array;
		const index = geo.index.array;
		const triCount = index.length / 3;
		const bounds = new Float32Array( triCount * 6 );

		for ( let tri = 0; tri < triCount; tri ++ ) {

			const ai = index[ 3 * tri + 0 ] * 3;
			const bi = index[ 3 * tri + 1 ] * 3;
			const ci = index[ 3 * tri + 2 ] * 3;

			for ( let el = 0; el < 3; el ++ ) {

				const a = verts[ ai + el ];
				const b = verts[ bi + el ];
				const c = verts[ ci + el ];
				const min = Math.min( a, b, c );
				const max = Math.max( a, b, c );
				const halfExtents = ( max - min ) / 2;
				bounds[ tri * 6 + el * 2 + 0 ] = min + halfExtents;
				bounds[ tri * 6 + el * 2 + 1 ] = halfExtents;

			}

		}

		return bounds;

	}

	const boxtemp = new THREE.Box3();

	class BVHConstructionContext {

		constructor( geo, options ) {

			this.geo = geo;
			this.options = options;
			this.bounds = computeBounds( geo );

			// SAH Initialization
			this.sahplanes = null;
			if ( options.strategy === SAH ) {

				const triCount = geo.index.count / 3;
				this.sahplanes = [ new Array( triCount ), new Array( triCount ), new Array( triCount ) ];
				for ( let tri = 0; tri < triCount; tri ++ ) {

					for ( let el = 0; el < 3; el ++ ) {

						this.sahplanes[ el ][ tri ] = { p: this.bounds[ tri * 6 + el * 2 ], tri };

					}

				}

			}

		}

		// returns the average coordinate on the specified axis of the all the provided triangles
		getAverage( offset, count, axis ) {

			let avg = 0;
			const bounds = this.bounds;

			for ( let i = offset, end = offset + count; i < end; i ++ ) {

				avg += bounds[ i * 6 + axis * 2 ];

			}

			return avg / count;

		}

		// computes the union of the bounds of all of the given triangles and puts the resulting box in target
		getBounds( offset, count, target ) {

			let minx = Infinity;
			let miny = Infinity;
			let minz = Infinity;
			let maxx = - Infinity;
			let maxy = - Infinity;
			let maxz = - Infinity;
			const bounds = this.bounds;

			for ( let i = offset, end = offset + count; i < end; i ++ ) {

				const cx = bounds[ i * 6 + 0 ];
				const hx = bounds[ i * 6 + 1 ];
				minx = Math.min( minx, cx - hx );
				maxx = Math.max( maxx, cx + hx );
				const cy = bounds[ i * 6 + 2 ];
				const hy = bounds[ i * 6 + 3 ];
				miny = Math.min( miny, cy - hy );
				maxy = Math.max( maxy, cy + hy );
				const cz = bounds[ i * 6 + 4 ];
				const hz = bounds[ i * 6 + 5 ];
				minz = Math.min( minz, cz - hz );
				maxz = Math.max( maxz, cz + hz );

			}

			target[ 0 ] = minx;
			target[ 1 ] = miny;
			target[ 2 ] = minz;

			target[ 3 ] = maxx;
			target[ 4 ] = maxy;
			target[ 5 ] = maxz;

			return target;

		}

		// reorders `tris` such that for `count` elements after `offset`, elements on the left side of the split
		// will be on the left and elements on the right side of the split will be on the right. returns the index
		// of the first element on the right side, or offset + count if there are no elements on the right side.
		partition( offset, count, split ) {

			let left = offset;
			let right = offset + count - 1;
			const pos = split.pos;
			const axisOffset = split.axis * 2;
			const index = this.geo.index.array;
			const bounds = this.bounds;
			const sahplanes = this.sahplanes;

			// hoare partitioning, see e.g. https://en.wikipedia.org/wiki/Quicksort#Hoare_partition_scheme
			while ( true ) {

				while ( left <= right && bounds[ left * 6 + axisOffset ] < pos ) {

					left ++;

				}

				while ( left <= right && bounds[ right * 6 + axisOffset ] >= pos ) {

					right --;

				}

				if ( left < right ) {

					// we need to swap all of the information associated with the triangles at index
					// left and right; that's the verts in the geometry index, the bounds,
					// and perhaps the SAH planes

					for ( let i = 0; i < 3; i ++ ) {

						let t0 = index[ left * 3 + i ];
						index[ left * 3 + i ] = index[ right * 3 + i ];
						index[ right * 3 + i ] = t0;
						let t1 = bounds[ left * 6 + i * 2 + 0 ];
						bounds[ left * 6 + i * 2 + 0 ] = bounds[ right * 6 + i * 2 + 0 ];
						bounds[ right * 6 + i * 2 + 0 ] = t1;
						let t2 = bounds[ left * 6 + i * 2 + 1 ];
						bounds[ left * 6 + i * 2 + 1 ] = bounds[ right * 6 + i * 2 + 1 ];
						bounds[ right * 6 + i * 2 + 1 ] = t2;

					}

					if ( sahplanes ) {

						for ( let i = 0; i < 3; i ++ ) {

							let t = sahplanes[ i ][ left ];
							sahplanes[ i ][ left ] = sahplanes[ i ][ right ];
							sahplanes[ i ][ right ] = t;

						}

					}

					left ++;
					right --;

				} else {

					return left;

				}

			}

		}

		getOptimalSplit( bounds, offset, count, strategy ) {

			let axis = - 1;
			let pos = 0;

			// Center
			if ( strategy === CENTER ) {

				axis = getLongestEdgeIndex( bounds );
				if ( axis !== - 1 ) {

					pos = ( bounds[ axis + 3 ] + bounds[ axis ] ) / 2;

				}

			} else if ( strategy === AVERAGE ) {

				axis = getLongestEdgeIndex( bounds );
				if ( axis !== - 1 ) {

					pos = this.getAverage( offset, count, axis );

				}

			} else if ( strategy === SAH ) {

				// Surface Area Heuristic
				// In order to make this code more terse, the x, y, and z
				// variables of various structures have been stuffed into
				// 0, 1, and 2 array indices so they can be easily computed
				// and accessed within array iteration

				// Cost values defineed for operations. We're using bounds for traversal, so
				// the cost of traversing one more layer is more than intersecting a triangle.
				const TRAVERSAL_COST = 3;
				const INTERSECTION_COST = 1;
				const bb = arrayToBox( bounds, boxtemp );

				// Define the width, height, and depth of the bounds as a box
				const dim = [
					bb.max.x - bb.min.x,
					bb.max.y - bb.min.y,
					bb.max.z - bb.min.z
				];
				const sa = 2 * ( dim[ 0 ] * dim[ 1 ] + dim[ 0 ] * dim[ 2 ] + dim[ 1 ] * dim[ 2 ] );

				// Get the precalculated planes based for the triangles we're
				// testing here
				const filteredLists = [[], [], []];
				for ( let i = offset, end = offset + count; i < end; i ++ ) {

					for ( let v = 0; v < 3; v ++ ) {

						filteredLists[ v ].push( this.sahplanes[ v ][ i ] );

					}

				}
				filteredLists.forEach( planes => planes.sort( ( a, b ) => a.p - b.p ) );

				// this bounds surface area, left bound SA, left triangles, right bound SA, right triangles
				const getCost = ( sa, sal, nl, sar, nr ) =>
					  TRAVERSAL_COST + INTERSECTION_COST * ( ( sal / sa ) * nl + ( sar / sa ) * nr );

				// the cost of _not_ splitting into smaller bounds
				const noSplitCost = INTERSECTION_COST * count;

				axis = - 1;
				let bestCost = noSplitCost;
				for ( let i = 0; i < 3; i ++ ) {

					// o1 and o2 represent the _other_ two axes in the
					// the space. So if we're checking the x (0) dimension,
					// then o1 and o2 would be y and z (1 and 2)
					const o1 = ( i + 1 ) % 3;
					const o2 = ( i + 2 ) % 3;

					const bmin = bb.min[ xyzFields$1[ i ] ];
					const bmax = bb.max[ xyzFields$1[ i ] ];
					const planes = filteredLists[ i ];

					// The number of left and right triangles on either side
					// given the current split
					let nl = 0;
					let nr = count;
					for ( let p = 0; p < planes.length; p ++ ) {

						const pinfo = planes[ p ];

						// As the plane moves, we have to increment or decrement the
						// number of triangles on either side of the plane
						nl ++;
						nr --;

						// the distance from the plane to the edge of the broader bounds
						const ldim = pinfo.p - bmin;
						const rdim = bmax - pinfo.p;

						// same for the other two dimensions
						let ldimo1 = dim[ o1 ], rdimo1 = dim[ o1 ];
						let ldimo2 = dim[ o2 ], rdimo2 = dim[ o2 ];

						/*
						// compute the other bounding planes for the box
						// if only the current triangles are considered to
						// be in the box
						// This is really slow and probably not really worth it
						const o1planes = this.sahplanes[o1];
						const o2planes = this.sahplanes[o2];
						let lmin = Infinity, lmax = -Infinity;
						let rmin = Infinity, rmax = -Infinity;
						planes.forEach((p, i) => {
						const tri2 = p.tri * 2;
						const inf1 = o1planes[tri2 + 0];
						const inf2 = o1planes[tri2 + 1];
						if (i <= nl) {
						lmin = Math.min(inf1.p, inf2.p, lmin);
						lmax = Math.max(inf1.p, inf2.p, lmax);
						}
						if (i >= nr) {
						rmin = Math.min(inf1.p, inf2.p, rmin);
						rmax = Math.max(inf1.p, inf2.p, rmax);
						}
						})
						ldimo1 = Math.min(lmax - lmin, ldimo1);
						rdimo1 = Math.min(rmax - rmin, rdimo1);

						planes.forEach((p, i) => {
						const tri2 = p.tri * 2;
						const inf1 = o2planes[tri2 + 0];
						const inf2 = o2planes[tri2 + 1];
						if (i <= nl) {
						lmin = Math.min(inf1.p, inf2.p, lmin);
						lmax = Math.max(inf1.p, inf2.p, lmax);
						}
						if (i >= nr) {
						rmin = Math.min(inf1.p, inf2.p, rmin);
						rmax = Math.max(inf1.p, inf2.p, rmax);
						}
						})
						ldimo2 = Math.min(lmax - lmin, ldimo2);
						rdimo2 = Math.min(rmax - rmin, rdimo2);
						*/

						// surface areas and cost
						const sal = 2 * ( ldimo1 * ldimo2 + ldimo1 * ldim + ldimo2 * ldim );
						const sar = 2 * ( rdimo1 * rdimo2 + rdimo1 * rdim + rdimo2 * rdim );
						const cost = getCost( sa, sal, nl, sar, nr );

						if ( cost < bestCost ) {

							axis = i;
							pos = pinfo.p;
							bestCost = cost;

						}

					}

				}

			}

			return { axis, pos };

		}

	}

	class MeshBVH {

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
				verbose: true

			}, options );
			options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

			this._roots = this._buildTree( geo, options );


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
			let reachedMaxDepth = false;

			// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
			// recording the offset and count of its triangles and writing them into the reordered geometry index.
			const splitNode = ( node, offset, count, depth = 0 ) => {

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
				const split = ctx.getOptimalSplit( node.boundingData, offset, count, options.strategy );
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
					left.boundingData = ctx.getBounds( lstart, lcount, new Float32Array( 6 ) );
					splitNode( left, lstart, lcount, depth + 1 );

					// repeat for right
					const right = node.right = new MeshBVHNode();
					const rstart = splitOffset, rcount = count - lcount;
					right.boundingData = ctx.getBounds( rstart, rcount, new Float32Array( 6 ) );
					splitNode( right, rstart, rcount, depth + 1 );

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

				} else {

					root.boundingData = ctx.getBounds( range.offset, range.count, new Float32Array( 6 ) );

				}

				splitNode( root, range.offset, range.count );
				roots.push( root );

			} else {

				for ( let range of ranges ) {

					const root = new MeshBVHNode();
					root.boundingData = ctx.getBounds( range.offset, range.count, new Float32Array( 6 ) );
					splitNode( root, range.offset, range.count );
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

		raycast( mesh, raycaster, ray, intersects ) {

			for ( const root of this._roots ) {

				root.raycast( mesh, raycaster, ray, intersects );

			}

		}

		raycastFirst( mesh, raycaster, ray ) {

			let closestResult = null;

			for ( const root of this._roots ) {

				const result = root.raycastFirst( mesh, raycaster, ray );
				if ( result != null && ( closestResult == null || result.distance < closestResult.distance ) ) {

					closestResult = result;

				}

			}

			return closestResult;

		}

		intersectsGeometry( mesh, geometry, geomToMesh ) {

			for ( const root of this._roots ) {

				if ( root.intersectsGeometry( mesh, geometry, geomToMesh ) ) return true;

			}

			return false;

		}

		shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc = null, orderNodesFunc = null ) {

			for ( const root of this._roots ) {

				if ( root.shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc, orderNodesFunc ) ) return true;

			}

			return false;

		}

		intersectsBox( mesh, box, boxToMesh ) {

			for ( const root of this._roots ) {

				if ( root.intersectsBox( mesh, box, boxToMesh ) ) return true;

			}

			return false;

		}

		intersectsSphere( mesh, sphere ) {

			for ( const root of this._roots ) {

				if ( root.intersectsSphere( mesh, sphere ) ) return true;

			}

			return false;

		}

		closestPointToGeometry( mesh, geom, matrix, target1, target2, minThreshold, maxThreshold ) {

			let closestDistance = Infinity;
			for ( const root of this._roots ) {

				const dist = root.closestPointToGeometry( mesh, geom, matrix, target1, target2, minThreshold, maxThreshold );
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

				const dist = root.closestPointToPoint( mesh, point, target, minThreshold, maxThreshold );
				if ( dist < closestDistance ) closestDistance = dist;
				if ( dist < minThreshold ) return dist;

			}

			return closestDistance;

		}

		distanceToPoint( mesh, point, minThreshold, maxThreshold ) {

			return this.closestPointToPoint( mesh, point, null, minThreshold, maxThreshold );

		}

	}

	const wiremat = new THREE.LineBasicMaterial( { color: 0x00FF88, transparent: true, opacity: 0.3 } );
	const boxGeom = new THREE.Box3Helper().geometry;
	let boundingBox$1 = new THREE.Box3();

	class MeshBVHRootVisualizer extends THREE.Object3D {

		constructor( mesh, depth = 10, group = 0 ) {

			super( 'MeshBVHRootVisualizer' );

			this.depth = depth;
			this._oldDepth = - 1;
			this._mesh = mesh;
			this._boundsTree = null;
			this._group = group;

			this.update();

		}

		update() {

			if ( this._mesh.geometry.boundsTree !== this._boundsTree || this._oldDepth !== this.depth ) {

				this._oldDepth = this.depth;
				this._boundsTree = this._mesh.geometry.boundsTree;

				let requiredChildren = 0;
				if ( this._boundsTree ) {

					const recurse = ( n, d ) => {

						let isLeaf = 'count' in n;

						if ( d === this.depth ) return;

						if ( d === this.depth - 1 || isLeaf ) {

							let m = requiredChildren < this.children.length ? this.children[ requiredChildren ] : null;
							if ( ! m ) {

								m = new THREE.LineSegments( boxGeom, wiremat );
								m.raycast = () => [];
								this.add( m );

							}
							requiredChildren ++;
							arrayToBox( n.boundingData, boundingBox$1 );
							boundingBox$1.getCenter( m.position );
							m.scale.subVectors( boundingBox$1.max, boundingBox$1.min ).multiplyScalar( 0.5 );

							if ( m.scale.x === 0 ) m.scale.x = Number.EPSILON;
							if ( m.scale.y === 0 ) m.scale.y = Number.EPSILON;
							if ( m.scale.z === 0 ) m.scale.z = Number.EPSILON;

						}

						if ( ! isLeaf ) {

							recurse( n.left, d + 1 );
							recurse( n.right, d + 1 );

						}

					};

					recurse( this._boundsTree._roots[ this._group ], 0 );

				}

				while ( this.children.length > requiredChildren ) this.remove( this.children.pop() );

			}

		}

	}

	class MeshBVHVisualizer extends THREE.Object3D {

		constructor( mesh, depth = 10 ) {

			super( 'MeshBVHVisualizer' );

			this.depth = depth;
			this._mesh = mesh;
			this._roots = [];

			this.update();

		}

		update() {

			const bvh = this._mesh.geometry.boundsTree;
			const totalRoots = bvh ? bvh._roots.length : 0;
			while ( this._roots.length > totalRoots ) {

				this._roots.pop();

			}

			for ( let i = 0; i < totalRoots; i ++ ) {

				if ( i >= this._roots.length ) {

					const root = new MeshBVHRootVisualizer( this._mesh, this.depth, i );
					this.add( root );
					this._roots.push( root );

				} else {

					let root = this._roots[ i ];
					root.depth = this.depth;
					root.update();

				}

			}

			this.position.copy( this._mesh.position );
			this.rotation.copy( this._mesh.rotation );
			this.scale.copy( this._mesh.scale );

		}

	}

	const ray = new THREE.Ray();
	const tmpInverseMatrix = new THREE.Matrix4();
	const origMeshRaycastFunc = THREE.Mesh.prototype.raycast;

	function acceleratedRaycast( raycaster, intersects ) {

		if ( this.geometry.boundsTree ) {

			if ( this.material === undefined ) return;

			tmpInverseMatrix.getInverse( this.matrixWorld );
			ray.copy( raycaster.ray ).applyMatrix4( tmpInverseMatrix );

			if ( raycaster.firstHitOnly === true ) {

				const res = this.geometry.boundsTree.raycastFirst( this, raycaster, ray );
				if ( res ) intersects.push( res );

			} else {

				this.geometry.boundsTree.raycast( this, raycaster, ray, intersects );

			}

		} else {

			origMeshRaycastFunc.call( this, raycaster, intersects );

		}

	}

	function computeBoundsTree( options ) {

		this.boundsTree = new MeshBVH( this, options );
		return this.boundsTree;

	}

	function disposeBoundsTree() {

		this.boundsTree = null;

	}

	exports.MeshBVH = MeshBVH;
	exports.Visualizer = MeshBVHVisualizer;
	exports.acceleratedRaycast = acceleratedRaycast;
	exports.computeBoundsTree = computeBoundsTree;
	exports.disposeBoundsTree = disposeBoundsTree;
	exports.CENTER = CENTER;
	exports.AVERAGE = AVERAGE;
	exports.SAH = SAH;

	Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=index.js.map
