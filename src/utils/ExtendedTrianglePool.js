import { ExtendedTriangle } from '../math/ExtendedTriangle';
import { PrimitivePool } from './PrimitivePool.js';

class ExtendedTrianglePoolBase extends PrimitivePool {

	constructor() {

		super( () => new ExtendedTriangle() );

	}

}

export const ExtendedTrianglePool = /* @__PURE__ */ new ExtendedTrianglePoolBase();
