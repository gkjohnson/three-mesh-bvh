import { Triangle, Vector3, Line3, Sphere, Plane } from 'three';
import { SeparatingAxisBounds } from './SeparatingAxisBounds.js';
import { closestPointsSegmentToSegment, sphereIntersectTriangle } from './MathUtilities.js';

export class SeparatingAxisTriangle extends Triangle {

	constructor( ...args ) {

		super( ...args );

		this.isSeparatingAxisTriangle = true;
		this.satAxes = new Array( 4 ).fill().map( () => new Vector3() );
		this.satBounds = new Array( 4 ).fill().map( () => new SeparatingAxisBounds() );
		this.points = [ this.a, this.b, this.c ];
		this.sphere = new Sphere();
		this.plane = new Plane();
		this.needsUpdate = false;

	}

	intersectsSphere( sphere ) {

		return sphereIntersectTriangle( sphere, this );

	}

	update() {

		const a = this.a;
		const b = this.b;
		const c = this.c;
		const points = this.points;

		const satAxes = this.satAxes;
		const satBounds = this.satBounds;

		const axis0 = satAxes[ 0 ];
		const sab0 = satBounds[ 0 ];
		this.getNormal( axis0 );
		sab0.setFromPoints( axis0, points );

		const axis1 = satAxes[ 1 ];
		const sab1 = satBounds[ 1 ];
		axis1.subVectors( a, b );
		sab1.setFromPoints( axis1, points );

		const axis2 = satAxes[ 2 ];
		const sab2 = satBounds[ 2 ];
		axis2.subVectors( b, c );
		sab2.setFromPoints( axis2, points );

		const axis3 = satAxes[ 3 ];
		const sab3 = satBounds[ 3 ];
		axis3.subVectors( c, a );
		sab3.setFromPoints( axis3, points );

		this.sphere.setFromPoints( this.points );
		this.plane.setFromNormalAndCoplanarPoint( axis0, a );
		this.needsUpdate = false;

	}

}

SeparatingAxisTriangle.prototype.closestPointToSegment = ( function () {

	const point1 = new Vector3();
	const point2 = new Vector3();
	const edge = new Line3();

	return function distanceToSegment( segment, target1 = null, target2 = null ) {

		const { start, end } = segment;
		const points = this.points;
		let distSq;
		let closestDistanceSq = Infinity;

		// check the triangle edges
		for ( let i = 0; i < 3; i ++ ) {

			const nexti = ( i + 1 ) % 3;
			edge.start.copy( points[ i ] );
			edge.end.copy( points[ nexti ] );

			closestPointsSegmentToSegment( edge, segment, point1, point2 );

			distSq = point1.distanceToSquared( point2 );
			if ( distSq < closestDistanceSq ) {

				closestDistanceSq = distSq;
				if ( target1 ) target1.copy( point1 );
				if ( target2 ) target2.copy( point2 );

			}

		}

		// check end points
		this.closestPointToPoint( start, point1 );
		distSq = start.distanceToSquared( point1 );
		if ( distSq < closestDistanceSq ) {

			closestDistanceSq = distSq;
			if ( target1 ) target1.copy( point1 );
			if ( target2 ) target2.copy( start );

		}

		this.closestPointToPoint( end, point1 );
		distSq = end.distanceToSquared( point1 );
		if ( distSq < closestDistanceSq ) {

			closestDistanceSq = distSq;
			if ( target1 ) target1.copy( point1 );
			if ( target2 ) target2.copy( end );

		}

		return Math.sqrt( closestDistanceSq );

	};

} )();

SeparatingAxisTriangle.prototype.intersectsTriangle = ( function () {

	const saTri2 = new SeparatingAxisTriangle();
	const arr1 = new Array( 3 );
	const arr2 = new Array( 3 );
	const cachedSatBounds = new SeparatingAxisBounds();
	const cachedSatBounds2 = new SeparatingAxisBounds();
	const cachedAxis = new Vector3();
	const dir1 = new Vector3();
	const dir2 = new Vector3();
	const tempDir = new Vector3();
	const edge = new Line3();
	const edge1 = new Line3();
	const edge2 = new Line3();

	// TODO: If the triangles are coplanar and intersecting the target is nonsensical. It should at least
	// be a line contained by both triangles if not a different special case somehow represented in the return result.
	return function intersectsTriangle( other, target = null ) {

		if ( this.needsUpdate ) {

			this.update();

		}

		if ( ! other.isSeparatingAxisTriangle ) {

			saTri2.copy( other );
			saTri2.update();
			other = saTri2;

		} else if ( other.needsUpdate ) {

			other.update();

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

		if ( target ) {

			const plane1 = this.plane;
			const plane2 = other.plane;

			if ( Math.abs( plane1.normal.dot( plane2.normal ) ) > 1.0 - 1e-10 ) {

				// TODO find two points that intersect on the edges and make that the result
				console.warn( 'SeparatingAxisTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0.' );
				target.start.set( 0, 0, 0 );
				target.end.set( 0, 0, 0 );

			} else {

				// find the edge that intersects the other triangle plane
				const points1 = this.points;
				let found1 = false;
				for ( let i = 0; i < 3; i ++ ) {

					const p1 = points1[ i ];
					const p2 = points1[ ( i + 1 ) % 3 ];

					edge.start.copy( p1 );
					edge.end.copy( p2 );

					if ( plane2.intersectLine( edge, found1 ? edge1.start : edge1.end ) ) {

						if ( found1 ) {

							break;

						}

						found1 = true;

					}

				}

				// find the other triangles edge that intersects this plane
				const points2 = other.points;
				let found2 = false;
				for ( let i = 0; i < 3; i ++ ) {

					const p1 = points2[ i ];
					const p2 = points2[ ( i + 1 ) % 3 ];

					edge.start.copy( p1 );
					edge.end.copy( p2 );

					if ( plane1.intersectLine( edge, found2 ? edge2.start : edge2.end ) ) {

						if ( found2 ) {

							break;

						}

						found2 = true;

					}

				}

				// find swap the second edge so both lines are running the same direction
				edge1.delta( dir1 );
				edge2.delta( dir2 );


				if ( dir1.dot( dir2 ) < 0 ) {

					let tmp = edge2.start;
					edge2.start = edge2.end;
					edge2.end = tmp;

				}

				tempDir.subVectors( edge1.start, edge2.start );
				if ( tempDir.dot( dir1 ) > 0 ) {

					target.start.copy( edge1.start );

				} else {

					target.start.copy( edge2.start );

				}

				tempDir.subVectors( edge1.end, edge2.end );
				if ( tempDir.dot( dir1 ) < 0 ) {

					target.end.copy( edge1.end );

				} else {

					target.end.copy( edge2.end );

				}

			}

		}

		return true;

	};

} )();


SeparatingAxisTriangle.prototype.distanceToPoint = ( function () {

	const target = new Vector3();
	return function distanceToPoint( point ) {

		this.closestPointToPoint( point, target );
		return point.distanceTo( target );

	};

} )();


SeparatingAxisTriangle.prototype.distanceToTriangle = ( function () {

	const point = new Vector3();
	const point2 = new Vector3();
	const cornerFields = [ 'a', 'b', 'c' ];
	const line1 = new Line3();
	const line2 = new Line3();

	return function distanceToTriangle( other, target1 = null, target2 = null ) {

		const lineTarget = target1 || target2 ? line1 : null;
		if ( this.intersectsTriangle( other, lineTarget ) ) {

			if ( target1 || target2 ) {

				if ( target1 ) lineTarget.getCenter( target1 );
				if ( target2 ) lineTarget.getCenter( target2 );

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

