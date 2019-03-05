import { Box3, Vector3, Matrix4 } from 'three';
import { SeparatingAxisBounds } from './SeparatingAxisBounds.js';
import { SeparatingAxisTriangle } from './SeparatingAxisTriangle.js';

const rightVector = new Vector3( 1, 0, 0 );
const upVector = new Vector3( 0, 1, 0 );
const forwardVector = new Vector3( 0, 0, 1 );
export class OrientedBox3 extends Box3 {

	constructor( ...args ) {

		super( ...args );

		this.isOrientedBox = true;
		this.matrix = new Matrix4();
		this.points = new Array( 8 ).fill().map( () => new Vector3() );
		this.satAxes = new Array( 3 ).fill().map( () => new Vector3() );
		this.satBounds = new Array( 3 ).fill().map( () => new SeparatingAxisBounds() );
		this.alignedSatBounds = new Array( 3 ).fill().map( () => new SeparatingAxisBounds() );

	}

	set( min, max, matrix ) {

		super.set( min, max );
		this.matrix = matrix;

	}

	copy( other ) {

		super( other );
		this.matrix = other.matrix;

	}

}

OrientedBox3.prototype.update = ( function () {

	const v1 = new Vector3();
	const v2 = new Vector3();
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

		const satBounds = this.satBounds;
		const satAxes = this.satAxes = new Array( 3 ).fill().map( () => new Vector3() );
		for ( let i = 0; i < 3; i ++ ) {

			const axis = satAxes[ i ];
			const sb = satBounds[ i ];
			v1.copy( min );
			v2.copy( min );
			if ( i === 0 ) v2.x = max.x;
			if ( i === 1 ) v2.y = max.y;
			if ( i === 2 ) v2.z = max.z;

			v1.applyMatrix4( matrix );
			v2.applyMatrix4( matrix );

			axis.subVectors( v1, v2 );
			sb.setFromPoints( axis, points );

		}

		const alignedSatBounds = this.alignedSatBounds;
		alignedSatBounds[ 0 ].setFromPoints( rightVector, points );
		alignedSatBounds[ 1 ].setFromPoints( upVector, points );
		alignedSatBounds[ 2 ].setFromPoints( forwardVector, points );

	};

} )();

OrientedBox3.prototype.intersectsBox = ( function () {

	const aabbBounds = new SeparatingAxisBounds();
	return function intersectsBox( box ) {

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

OrientedBox3.prototype.intersectsTriangle = ( function () {

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
