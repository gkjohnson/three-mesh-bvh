
// From research papers https://hal.inria.fr/inria-00072100/document

import { Vector3, Matrix4 } from 'three';

const EPSILON = 1e-10;

const _matrix = new Matrix4();
const _tmp = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _p1q1 = new Vector3();
const _p1r1 = new Vector3();
const _p2q2 = new Vector3();
const _p2r2 = new Vector3();
const _n1 = new Vector3();
const _n2 = new Vector3();

const Orient3D = {
	Positive: 1,
	Negative: - 1,
	Coplanar: 0
};

function determinant3D( a, b, c, d ) {

	_matrix.set(
		a.x, a.y, a.z, 1,
		b.x, b.y, b.z, 1,
		c.x, c.y, c.z, 1,
		d.x, d.y, d.z, 1
	);
	return _matrix.determinant();

}

function orientation3D( a, b, c, d ) {

	const det = determinant3D( a, b, c, d );
	if ( det > EPSILON ) {

		return Orient3D.Positive;

	} else if ( det < - EPSILON ) {

		return Orient3D.Negative;

	}

	return Orient3D.Coplanar;

}

function permuteTriLeft( p, q, r ) {

	_tmp.copy( p );
	p.copy( q );
	q.copy( r );
	r.copy( _tmp );

}

function permuteTriRight( p, q, r ) {

	_tmp.copy( r );
	r.copy( q );
	q.copy( p );
	p.copy( _tmp );

}

function swap( a, b ) {

	_tmp.copy( a );
	a.copy( b );
	b.copy( _tmp );

}


export function trianglesIntersectDevillers( t1, t2, target = null ) {

	// Follow paper's convention
	const p1 = t1.a;
	const q1 = t1.b;
	const r1 = t1.c;

	const p2 = t2.a;
	const q2 = t2.b;
	const r2 = t2.c;

	// Check relative position of t1's vertices againt t2
	const op1 = orientation3D( p2, q2, r2, p1 );
	const oq1 = orientation3D( p2, q2, r2, q1 );
	const or1 = orientation3D( p2, q2, r2, r1 );

	if ( op1 === oq1 && op1 === or1 ) {

		if ( op1 === Orient3D.Coplanar ) {

			console.warn( "Triangles are coplanar." );
			return handleCoplanarTriangles();

		} else {

			return false;

		}

	}

	return handleCrossTriangles( p1, q1, r1, p2, q2, r2, op1, oq1, or1, target );

}

function handleCrossTriangles( p1, q1, r1, p2, q2, r2, op1, oq1, or1, target ) {

	// Check relative position of t1's vertices againt t2
	const op2 = orientation3D( p1, q1, r1, p2 );
	const oq2 = orientation3D( p1, q1, r1, q2 );
	const or2 = orientation3D( p1, q1, r1, r2 );

	if ( op2 === oq2 && op2 === or2 ) {

		return false;

	}

	applyTriPermutations( p1, q1, r1, p2, q2, r2, op1, oq1, or1, op2, oq2, or2 );

	const o1 = orientation3D( p1, q1, p2, q2 );
	const o2 = orientation3D( p1, r1, r2, p2 );

	if ( o1 !== Orient3D.Positive && o2 !== Orient3D.Positive ) {

		if ( target ) {

			findCrossIntersection( p1, q1, r1, p2, q2, r2, target );

		}

		return true;

	}

	return false;

}

function intersectPlane( a, b, p, n, target ) {

	_u.subVectors( b, a );
	_v.subVectors( a, p );
	const dot1 = n.dot( _u );
	const dot2 = n.dot( _v );
	_u.multiplyScalar( - dot2 / dot1 );
	target.addVectors( a, _u );

}


function findCrossIntersection( p1, q1, r1, p2, q2, r2, target ) {

	_p1q1.subVectors( q1, p1 );
	_p1r1.subVectors( r1, p1 );
	_p2q2.subVectors( q2, p2 );
	_p2r2.subVectors( r2, p2 );

	_n1.crossVectors( _p1q1, _p1r1 );
	_n2.crossVectors( _p2q2, _p2r2 );

	const o1 = orientation3D( p1, r1, q2, p2 );
	const o2 = orientation3D( p1, q1, r2, p2 );

	if ( o1 === Orient3D.Positive ) {

		if ( o2 === Orient3D.Positive ) {

			// Intersection: k i l j
			intersectPlane( p1, r1, p2, _n2, target.start ); // i
			intersectPlane( p2, r2, p1, _n1, target.end ); // l

		} else {

			// Intersection: k i j l
			intersectPlane( p1, r1, p2, _n2, target.start ); // i
			intersectPlane( p1, q1, p2, _n2, target.end ); // j

		}

	} else {

		if ( o2 === Orient3D.Positive ) {

			// Intersection: i k l j
			intersectPlane( p2, q2, p1, _n1, target.start ); // k
			intersectPlane( p2, r2, p1, _n1, target.end ); // l

		} else {

			// Intersection: i k j l
			intersectPlane( p2, q2, p1, _n1, target.end ); // i
			intersectPlane( p1, q1, p2, _n2, target.start ); // k

		}

	}

}

function applyTriPermutations( p1, q1, r1, p2, q2, r2, op1, oq1, or1, op2, oq2, or2,
) {

	if ( op1 === oq1 ) {

		// r1 is alone, permute so r1 becomes p1
		permuteTriRight( p1, q1, r1 );

	} else if ( op1 === or1 ) {

		// q1 is alone, permute so q1 becomes p1
		permuteTriLeft( p1, q1, r1 );

	} else if ( oq1 !== or1 ) {

		if ( oq1 === Orient3D.Positive ) {

			permuteTriLeft( p1, q1, r1 );

		} else if ( or1 === Orient3D.Positive ) {

			permuteTriRight( p1, q1, r1 );

		}

	}


	if ( op2 === oq2 ) {

		// r2 is alone, permute so r2 becomes p2
		permuteTriRight( p2, q2, r2 );

	} else if ( op2 === or2 ) {

		// q2 is alone, permute so q2 becomes p2
		permuteTriLeft( p2, q2, r2 );

	} else if ( oq2 !== or2 ) {

		if ( oq2 === Orient3D.Positive ) {

			permuteTriLeft( p2, q2, r2 );

		} else if ( or2 === Orient3D.Positive ) {

			permuteTriRight( p2, q2, r2 );

		}

	}


	// Get p1 on positive side:
	const o1 = orientation3D( p2, q2, r2, p1 );
	if ( o1 === Orient3D.Negative ) {

		swap( q2, r2 );

	}

	// Get p2 on positive side:
	const o2 = orientation3D( p1, q1, r1, p2 );
	if ( o2 === Orient3D.Negative ) {

		swap( q1, r1 );

	}

}

function handleCoplanarTriangles() {

	return false;

}





