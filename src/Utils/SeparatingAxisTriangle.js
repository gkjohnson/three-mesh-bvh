import { Triangle, Vector3 } from 'three';
import { SeparatingAxisBounds } from './SeparatingAxisBounds.js';

class SeparatingAxisTriangle extends Triangle {

	constructor( ...args ) {

		super( ...args );

		this.isSeparatingAxisTriangle = true;
		this.satAxes = new Array( 4 ).fill().map( () => new Vector3() );
		this.satBounds = new Array( 4 ).fill().map( () => new SeparatingAxisBounds() );

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
		axis1.subtractVectors( a, b );
		sab1.setFromPoints( axis1, arr );

		const axis2 = satAxes[ 2 ];
		const sab2 = satBounds[ 2 ];
		axis2.subtractVectors( b, c );
		sab2.setFromPoints( axis2, arr );

		const axis3 = satAxes[ 3 ];
		const sab3 = satBounds[ 3 ];
		axis3.subtractVectors( a, b );
		sab3.setFromPoints( axis3, arr );

	};

} )();

SeparatingAxisTriangle.prototype.intersectsTriangle = ( function () {

	const saTri2 = new SeparatingAxisTriangle();
	const arr = new Array( 3 );
	const cacheSatBounds = new SeparatingAxisBounds();
	return function intersectsTriangle( other ) {

		if ( ! other.isSeparatingAxisTriangle ) {

			saTri2.copy( other );
			saTri2.update();
			other = saTri2;

		}

		let points, satBounds, satAxes;

		points = other.points;
		satBounds = this.satBounds;
		satAxes = this.satAxes;
		arr[ 0 ] = other.a;
		arr[ 1 ] = other.b;
		arr[ 2 ] = other.c;
		for ( let i = 0; i < 4; i ++ ) {

			const sb = satBounds[ i ];
			const sa = satAxes[ i ];
			cacheSatBounds.setFromPoints( sa, points );
			if ( sb.isSeparated( cacheSatBounds ) ) return false;

		}

		points = this.points;
		satBounds = other.satBounds;
		satAxes = other.satAxes;
		arr[ 0 ] = this.a;
		arr[ 1 ] = this.b;
		arr[ 2 ] = this.c;
		for ( let i = 0; i < 4; i ++ ) {

			const sb = satBounds[ i ];
			const sa = satAxes[ i ];
			cacheSatBounds.setFromPoints( sa, points );
			if ( sb.isSeparated( cacheSatBounds ) ) return false;

		}

		return true;

	};

} )();
