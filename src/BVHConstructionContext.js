import { SAH } from './Constants.js';
import { computeTriangleBounds } from './buildFunctions.js';

export default class BVHConstructionContext {

	constructor( geo, options ) {

		this.geo = geo;
		this.options = options;
		this.bounds = computeTriangleBounds( geo );

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

}
