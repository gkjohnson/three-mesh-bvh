import { Vector3, Triangle, Line3, MathUtils, Plane, BufferGeometry, BufferAttribute, LineSegments, LineBasicMaterial } from 'three';
import { ExtendedTriangle } from '../..';

const _v0 = new Vector3();
const _v1 = new Vector3();
const _dir0 = new Vector3();
const _dir1 = new Vector3();
const _tempDir = new Vector3();
const _normal = new Vector3();
const _triangle = new Triangle();
const _orthoPlane = new Plane();
const _line0 = new Line3();
const _line1 = new Line3();
const _tempLine = new Line3();
const _upVector = new Vector3( 0, 1, 0 );

// Modified version of js EdgesGeometry logic to handle silhouette edges
export function generateEdges( geometry, projectionDir, thresholdAngle = 1 ) {

	const edges = [];

	const precisionPoints = 4;
	const precision = Math.pow( 10, precisionPoints );
	const thresholdDot = Math.cos( MathUtils.DEG2RAD * thresholdAngle );

	const indexAttr = geometry.getIndex();
	const positionAttr = geometry.getAttribute( 'position' );
	const indexCount = indexAttr ? indexAttr.count : positionAttr.count;

	const indexArr = [ 0, 0, 0 ];
	const vertKeys = [ 'a', 'b', 'c' ];
	const hashes = new Array( 3 );

	const edgeData = {};
	for ( let i = 0; i < indexCount; i += 3 ) {

		if ( indexAttr ) {

			indexArr[ 0 ] = indexAttr.getX( i );
			indexArr[ 1 ] = indexAttr.getX( i + 1 );
			indexArr[ 2 ] = indexAttr.getX( i + 2 );

		} else {

			indexArr[ 0 ] = i;
			indexArr[ 1 ] = i + 1;
			indexArr[ 2 ] = i + 2;

		}

		const { a, b, c } = _triangle;
		a.fromBufferAttribute( positionAttr, indexArr[ 0 ] );
		b.fromBufferAttribute( positionAttr, indexArr[ 1 ] );
		c.fromBufferAttribute( positionAttr, indexArr[ 2 ] );
		_triangle.getNormal( _normal );

		// create hashes for the edge from the vertices
		hashes[ 0 ] = `${ Math.round( a.x * precision ) },${ Math.round( a.y * precision ) },${ Math.round( a.z * precision ) }`;
		hashes[ 1 ] = `${ Math.round( b.x * precision ) },${ Math.round( b.y * precision ) },${ Math.round( b.z * precision ) }`;
		hashes[ 2 ] = `${ Math.round( c.x * precision ) },${ Math.round( c.y * precision ) },${ Math.round( c.z * precision ) }`;

		// skip degenerate triangles
		if ( hashes[ 0 ] === hashes[ 1 ] || hashes[ 1 ] === hashes[ 2 ] || hashes[ 2 ] === hashes[ 0 ] ) {

			continue;

		}

		// iterate over every edge
		for ( let j = 0; j < 3; j ++ ) {

			// get the first and next vertex making up the edge
			const jNext = ( j + 1 ) % 3;
			const vecHash0 = hashes[ j ];
			const vecHash1 = hashes[ jNext ];
			const v0 = _triangle[ vertKeys[ j ] ];
			const v1 = _triangle[ vertKeys[ jNext ] ];

			const hash = `${ vecHash0 }_${ vecHash1 }`;
			const reverseHash = `${ vecHash1 }_${ vecHash0 }`;

			if ( reverseHash in edgeData && edgeData[ reverseHash ] ) {

				// if we found a sibling edge add it into the vertex array if
				// it meets the angle threshold and delete the edge from the map.
				const otherNormal = edgeData[ reverseHash ].normal;
				const meetsThreshold = _normal.dot( otherNormal ) <= thresholdDot;
				const projectionThreshold = Math.sign( projectionDir.dot( _normal ) ) !== Math.sign( projectionDir.dot( otherNormal ) );
				if ( meetsThreshold || projectionThreshold ) {

					const line = new Line3();
					line.start.copy( v0 );
					line.end.copy( v1 );
					edges.push( line );

				}

				edgeData[ reverseHash ] = null;

			} else if ( ! ( hash in edgeData ) ) {

				// if we've already got an edge here then skip adding a new one
				edgeData[ hash ] = {

					index0: indexArr[ j ],
					index1: indexArr[ jNext ],
					normal: _normal.clone(),

				};

			}

		}

	}

	// iterate over all remaining, unmatched edges and add them to the vertex array
	for ( const key in edgeData ) {

		if ( edgeData[ key ] ) {

			const { index0, index1 } = edgeData[ key ];
			_v0.fromBufferAttribute( positionAttr, index0 );
			_v1.fromBufferAttribute( positionAttr, index1 );

			const line = new Line3();
			line.start.copy( _v0 );
			line.end.copy( _v1 );
			edges.push( line );

		}

	}

	return edges;

}

// TODO: validate
export function lineIntersectTrianglePoint( line, triangle, target = null ) {

	target = target || {

		line: new Line3(),
		point: new Vector3(),
		planeHit: new Vector3(),
		type: '',

	};

	if ( triangle.getArea() < 1e-10 ) {

		return null;

	}

	if ( triangle.needsUpdate ) {

		triangle.update();

	}

	const pointTarget = target.point;
	const lineTarget = target.line;
	const { points, plane } = triangle;

	// if the line direction is orthogonal to the plane normal then they are potentially coplanar
	_line0.copy( line );
	_line0.delta( _dir0 );
	const areCoplanar = plane.normal.dot( _dir0 ) === 0.0;

	if ( areCoplanar ) {

		// a plane that's orthogonal to the triangle that the line lies on
		_dir0.cross( plane.normal ).normalize();
		_orthoPlane.setFromNormalAndCoplanarPoint( _dir0, _line0.start );

		// find the line of intersection of the triangle along the plane if it exists
		let intersectCount = 0;
		for ( let i = 0; i < 3; i ++ ) {

			const p1 = points[ i ];
			const p2 = points[ ( i + 1 ) % 3 ];

			_tempLine.start.copy( p1 );
			_tempLine.end.copy( p2 );
			if ( _orthoPlane.distanceToPoint( _tempLine.end ) === 0 && _orthoPlane.distanceToPoint( _tempLine.start ) === 0 ) {

				// if the edge lies on the plane then take the line
				_line1.copy( _tempLine );
				intersectCount = 2;
				break;

			} else if ( _orthoPlane.intersectLine( _tempLine, intersectCount === 0 ? _line1.start : _line1.end ) ) {

				let p;
				if ( intersectCount === 0 ) {

					p = _line1.start;

				} else {

					p = _line1.end;

				}

				if ( p.distanceTo( p2 ) === 0.0 ) {

					continue;

				}

				intersectCount ++;
				if ( intersectCount === 2 ) {

					break;

				}

			}

		}

		if ( intersectCount === 2 ) {

			// find the intersect line if any
			_line0.delta( _dir0 ).normalize();
			_line1.delta( _dir1 ).normalize();

			// swap edges so they're facing in the same direction
			if ( _dir0.dot( _dir1 ) < 0 ) {

				let tmp = _line1.start;
				_line1.start = _line1.end;
				_line1.end = tmp;

			}

			// check if the edges are overlapping
			const s1 = _line0.start.dot( _dir0 );
			const e1 = _line0.end.dot( _dir0 );
			const s2 = _line1.start.dot( _dir0 );
			const e2 = _line1.end.dot( _dir0 );
			const separated1 = e1 < s2;
			const separated2 = s1 < e2;

			if ( s1 !== e2 && s2 !== e1 && separated1 === separated2 ) {

				return null;

			}

			// assign the target output
			_tempDir.subVectors( _line0.start, _line1.start );
			if ( _tempDir.dot( _dir0 ) > 0 ) {

				lineTarget.start.copy( _line0.start );

			} else {

				lineTarget.start.copy( _line1.start );

			}

			_tempDir.subVectors( _line0.end, _line1.end );
			if ( _tempDir.dot( _dir0 ) < 0 ) {

				lineTarget.end.copy( _line0.end );

			} else {

				lineTarget.end.copy( _line1.end );

			}

			target.type = 'line';
			return target;

		}

	} else {

		// find the point that the line intersects the plane on
		const doesLineIntersect = triangle.plane.intersectLine( line, pointTarget );
		target.planeHit.copy( pointTarget );
		if ( doesLineIntersect ) {

			let totAngle = 0;
			for ( const i in points ) {

				const i1 = ( i + 1 ) % 3;
				_v0.subVectors( points[ i ], pointTarget );
				_v1.subVectors( points[ i1 ], pointTarget );

				const angle = _v0.angleTo( _v1 );
				const sign = Math.sign( _v0.cross( _v1 ).dot( plane.normal ) );

				totAngle += sign * angle;

			}

			if ( totAngle > 0 ) {

				target.type = 'point';
				return target;

			}

		}

	}

	return null;

}


export function getLineYAtPoint( line, point ) {

	let interp;
	if ( Math.abs( line.start.x - line.end.x ) < 1e-4 ) {

		interp = ( point.x - line.start.x ) / ( line.end.x - line.start.x );

	} else {

		interp = ( point.y - line.start.y ) / ( line.end.y - line.start.y );

	}

	return MathUtils.lerp( line.start.y, line.end.y, interp );

}

export function getTriYAtPoint( tri, point, target = null ) {

	const tl = new Line3();
	tl.start.copy( point );
	tl.end.copy( point );

	tl.start.y += 1e4;
	tl.end.y -= 1e4;

	tri.plane.intersectLine( tl, target );

}

export function isLineAboveTriangle( tri, line ) {

	_v0.lerpVectors( line.start, line.end, 0.5 );
	getTriYAtPoint( tri, _v0, _v1 );

	return _v1.y < _v0.y;

}

export function isProjectedTriangleDegenerate( tri ) {

	if ( tri.needsUpdate ) {

		tri.update();

	}

	return Math.abs( tri.plane.normal.dot( _upVector ) ) < 1e-10;

}

export function isLineTriangleEdge( tri, line ) {

	// if this is the same line as on the triangle
	const triPoints = tri.points;
	let matches = 0;
	for ( let i = 0; i < 3; i ++ ) {

		const { start, end } = line;
		const tp = triPoints[ i ];
		if ( start.distanceToSquared( tp ) < 1e-10 ) {

			matches ++;

		}

		if ( end.distanceToSquared( tp ) < 1e-10 ) {

			matches ++;

		}

	}

	return matches >= 2;

}

export function getProjectedOverlaps( tri, line, overlaps = [] ) {

	const target = {
		line: new Line3(),
		point: new Vector3(),
		planeHit: new Vector3(),
		type: '',
	};

	const tempDir = new Vector3();
	const tempVec0 = new Vector3();
	const tempVec1 = new Vector3();
	const _tri = new ExtendedTriangle();
	const _line = new Line3();

	_line.copy( line );
	_tri.copy( tri );
	_tri.needsUpdate = true;
	_tri.update();

	// flatten them to a common plane
	_line.start.y = 0;
	_line.end.y = 0;
	_tri.a.y = 0;
	_tri.b.y = 0;
	_tri.c.y = 0;
	_tri.needsUpdate = true;
	_tri.update();

	if ( _line.distance() > 1e-10 && lineIntersectTrianglePoint( _line, _tri, target ) && target.type === 'line' ) {

		_line.delta( tempDir );
		tempVec0.subVectors( target.line.start, _line.start );
		tempVec1.subVectors( target.line.end, _line.start );

		const d0 = tempVec0.length() / tempDir.length();
		const d1 = tempVec1.length() / tempDir.length();

		if ( ! ( Math.abs( d0 - d1 ) < 1e-10 ) ) {

			overlaps.push( [ d0, d1 ] );

		}

	}

	return overlaps;

}

export function trimToBeneathTriPlane( tri, line, lineTarget ) {

	if ( tri.needsUpdate ) {

		tri.update();

	}

	lineTarget.copy( line );

	// handle vertical triangles
	const { plane } = tri;
	if ( isProjectedTriangleDegenerate( tri ) ) {

		return false;

	}

	const dir = new Vector3();
	const planeHit = new Vector3();
	line.delta( dir );

	const areCoplanar = plane.normal.dot( dir ) === 0.0;
	if ( areCoplanar ) {

		return false;

	}

	const doesLineIntersect = plane.intersectLine( line, planeHit );
	if ( doesLineIntersect ) {

		const point = new Vector3();
		const p = new Vector3();
		const { start, end } = lineTarget;

		let testPoint;
		let flipped = false;
		if ( start.distanceTo( planeHit ) > end.distanceTo( planeHit ) ) {

			testPoint = start;

		} else {

			testPoint = end;
			flipped = true;

		}

		point.lerpVectors( testPoint, planeHit, 0.5 );
		getTriYAtPoint( tri, point, p );

		if ( p.y < point.y ) {

			if ( flipped ) end.copy( planeHit );
			else start.copy( planeHit );

		} else {

			if ( flipped ) start.copy( planeHit );
			else end.copy( planeHit );

		}

		return true;

	}

	return false;

}

export function overlapsToLines( line, overlaps, target = [] ) {

	overlaps = [ ...overlaps ];

	overlaps.sort( ( a, b ) => {

		return a[ 0 ] - b[ 0 ];

	} );

	for ( let i = 1; i < overlaps.length; i ++ ) {

		const overlap = overlaps[ i ];
		const prevOverlap = overlaps[ i - 1 ];

		if ( overlap[ 0 ] <= prevOverlap[ 1 ] ) {

			prevOverlap[ 1 ] = Math.max( prevOverlap[ 1 ], overlap[ 1 ] );
			overlaps.splice( i, 1 );
			i --;
			continue;

		}

	}

	const invOverlaps = [[ 0, 1 ]];
	for ( let i = 0, l = overlaps.length; i < l; i ++ ) {

		invOverlaps[ i ][ 1 ] = overlaps[ i ][ 0 ];
		invOverlaps.push( [ overlaps[ i ][ 1 ], 1 ] );

	}

	for ( let i = 0, l = invOverlaps.length; i < l; i ++ ) {

		const newLine = new Line3();
		newLine.start.lerpVectors( line.start, line.end, invOverlaps[ i ][ 0 ] );
		newLine.end.lerpVectors( line.start, line.end, invOverlaps[ i ][ 1 ] );
		target.push( newLine );

	}

	return target;

}

export function edgesToGeometry( edges, y = null ) {

	const edgeArray = new Float32Array( edges.length * 6 );
	let c = 0;
	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		const line = edges[ i ];
		edgeArray[ c ++ ] = line.start.x;
		edgeArray[ c ++ ] = y === null ? line.start.y : y;
		edgeArray[ c ++ ] = line.start.z;
		edgeArray[ c ++ ] = line.end.x;
		edgeArray[ c ++ ] = y === null ? line.end.y : y;
		edgeArray[ c ++ ] = line.end.z;

	}

	const edgeGeom = new BufferGeometry();
	const edgeBuffer = new BufferAttribute( edgeArray, 3, true );
	edgeGeom.setAttribute( 'position', edgeBuffer );
	return new LineSegments( edgeGeom, new LineBasicMaterial( { color: 0 } ) );

}
