import { BufferGeometry, BufferAttribute } from 'three';

export function getGeometry( index, position ) {

	const geometry = new BufferGeometry();
	if ( index ) {

		geometry.index = new BufferAttribute( index, 1, false );

	}

	geometry.setAttribute( 'position', new BufferAttribute( position, 3 ) );
	return geometry;

}

export function flattenNodes( node ) {

	const arr = [];
	traverse( node );
	return arr;

	function traverse( node, depth = 0 ) {

		node.depth = depth;
		arr.push( node );

		const isLeaf = Boolean( node.count );
		if ( ! isLeaf ) {

			traverse( node.left, depth + 1 );
			traverse( node.right, depth + 1 );

		}

	}

}
