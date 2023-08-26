import { BoxGeometry, Vector3 } from 'three';

export function generateGroupGeometry( complexity ) {

	const geometry = new BoxGeometry( 1, 1, 1, complexity, complexity, complexity );
	const position = geometry.attributes.position;
	const vertCount = position.count;
	const vec = new Vector3();
	for ( let i = 0; i < vertCount; i ++ ) {

		vec.fromBufferAttribute( position, i );
		vec.normalize();
		position.setXYZ( i, vec.x, vec.y, vec.z );

	}

	return geometry;

}
