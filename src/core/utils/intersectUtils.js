import { Box3 } from 'three';
import { arrayToBox } from '../../utils/ArrayBoxUtilities.js';

const _boundingBox = /* @__PURE__ */ new Box3();
export function intersectRay( nodeIndex32, array, ray, target ) {

	arrayToBox( nodeIndex32, array, _boundingBox );
	return ray.intersectBox( _boundingBox, target );

}
