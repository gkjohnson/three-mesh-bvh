import { Box3, Vector3, Matrix4, Sphere, Plane } from 'three';
import { SeparatingAxisBounds } from './SeparatingAxisBounds.js';
import { SeparatingAxisTriangle } from './SeparatingAxisTriangle.js';

export class OrientedBox extends Box3 {

	constructor( ...args ) {

		super( ...args );

		this.isOrientedBox = true;
		this.matrix = new Matrix4();
		this.points = new Array( 8 ).fill().map( () => new Vector3() );
		this.satAxes = new Array( 3 ).fill().map( () => new Vector3() );
		this.satBounds = new Array( 3 ).fill().map( () => new SeparatingAxisBounds() );
		this.alignedSatBounds = new Array( 3 ).fill().map( () => new SeparatingAxisBounds() );
		this.planes = new Array( 6 ).fill().map( () => new Plane() );
		this.sphere = new Sphere();

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
					v.x = min.x * x + max.x * ( 1 - x );
					v.y = min.y * y + max.y * ( 1 - y );
					v.z = min.z * z + max.z * ( 1 - z );

					v.applyMatrix4( matrix );

				}

			}

		}

		this.sphere.setFromPoints( this.points );

		const planes = this.planes;
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

			const p1 = planes[ i ];
			const p2 = planes[ i + 3 ];

			p1.setFromNormalAndCoplanarPoint( axis, minVec );
			p2.setFromNormalAndCoplanarPoint( axis, pi ).negate();

		}

		// const alignedSatBounds = this.alignedSatBounds;
		// alignedSatBounds[ 0 ].setFromPointsField( points, 'x' );
		// alignedSatBounds[ 1 ].setFromPointsField( points, 'y' );
		// alignedSatBounds[ 2 ].setFromPointsField( points, 'z' );

	};

} )();

OrientedBox.prototype.intersectsBox = ( function () {

	const vector = new Vector3();
	const xyzFields = [ 'x', 'y', 'z' ];
	return function intersectsBox( box ) {

		if ( ! box.intersectsSphere( this.sphere ) ) return false;

		const planes = this.planes;
		const points = this.points;

		// check the abb bounds planes
		const min = box.min;
		const max = box.max;
		for ( let i = 0; i < 3; i ++ ) {

			const field = xyzFields[ i ];
			const minVal = min[ field ];
			const maxVal = max[ field ];

			// save the side that we find the first field is on
			let didCross = false;
			for ( let i = 0; i < 8; i ++ ) {

				// For the negative side plane the point should be less to
				// separate the boxes. The opposite for max side
				const val = points[ i ][ field ];
				const obbSideMin = val >= minVal;
				const obbSideMax = val <= maxVal;

				// we've found a point that's on the opposite side of the plane
				if ( obbSideMin || obbSideMax ) {

					didCross = true;
					break;

				}

			}

			// if one plane separated all points then we found a separating plane
			if ( didCross === false ) {

				return false;

			}

		}

		// check the obb planes
		for ( let i = 0; i < 6; i ++ ) {

			// p1 is min side plane, p2 is max side plane
			const plane = planes[ i ];
			let didCross = false;

			pointsLoop :
			for ( let x = 0; x <= 1; x ++ ) {

				for ( let y = 0; y <= 1; y ++ ) {

					for ( let z = 0; z <= 1; z ++ ) {

						vector.x = min.x * x + max.x * ( 1 - x );
						vector.y = min.y * y + max.y * ( 1 - y );
						vector.z = min.z * z + max.z * ( 1 - z );

						// if the point doesn't fall on the side of the plane that points
						// away from the OBB, then it's not a separating plane
						if ( plane.distanceToPoint( vector ) <= 0 ) {

							didCross = true;
							break pointsLoop;

						}

					}

				}

			}

			if ( didCross === false ) {

				return false;

			}


		}

		return true;

	};

} )();

// OrientedBox.prototype.intersectsBox = ( function () {

// 	const aabbBounds = new SeparatingAxisBounds();
// 	return function intersectsBox( box ) {

// 		if ( ! box.intersectsSphere( this.sphere ) ) return false;

// 		const min = box.min;
// 		const max = box.max;
// 		const satBounds = this.satBounds;
// 		const satAxes = this.satAxes;
// 		const alignedSatBounds = this.alignedSatBounds;

// 		aabbBounds.min = min.x;
// 		aabbBounds.max = max.x;
// 		if ( alignedSatBounds[ 0 ].isSeparated( aabbBounds ) ) return false;

// 		aabbBounds.min = min.y;
// 		aabbBounds.max = max.y;
// 		if ( alignedSatBounds[ 1 ].isSeparated( aabbBounds ) ) return false;

// 		aabbBounds.min = min.z;
// 		aabbBounds.max = max.z;
// 		if ( alignedSatBounds[ 2 ].isSeparated( aabbBounds ) ) return false;

// 		for ( let i = 0; i < 3; i ++ ) {

// 			const axis = satAxes[ i ];
// 			const sb = satBounds[ i ];
// 			aabbBounds.setFromBox( axis, box );
// 			if ( sb.isSeparated( aabbBounds ) ) return false;

// 		}

// 		return true;

// 	};

// } )();

OrientedBox.prototype.intersectsTriangle = ( function () {

	const saTri = new SeparatingAxisTriangle();
	const pointsArr = new Array( 3 );
	const cacheSatBounds = new SeparatingAxisBounds();
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
			cacheSatBounds.setFromPoints( sa, pointsArr );
			if ( sb.isSeparated( cacheSatBounds ) ) return false;

		}

		const triSatBounds = triangle.satBounds;
		const triSatAxes = triangle.satAxes;
		const points = this.points;
		for ( let i = 0; i < 3; i ++ ) {

			const sb = triSatBounds[ i ];
			const sa = triSatAxes[ i ];
			cacheSatBounds.setFromPoints( sa, points );
			if ( sb.isSeparated( cacheSatBounds ) ) return false;

		}

		return true;

	};

} )();
