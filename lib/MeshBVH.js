import * as THREE from '../node_modules/three/build/three.module.js';
import MeshBVHNode from './MeshBVHNode.js';
import BVHConstructionContext from './BVHConstructionContext.js';
import { boundsToArray } from './BoundsUtilities.js';

export default class MeshBVH extends MeshBVHNode {

	constructor( geo, options = {} ) {

		super();

		// default options
		options = Object.assign( {

			strategy: 0,
			maxDepth: Infinity,
			maxLeafNodes: 10

		}, options );
		options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

		if ( geo.isBufferGeometry ) {

			this._root = this._buildTree( geo, options );

		} else {

			throw new Error( 'Only BufferGeometries are supported.' );

		}

	}

	/* Private Functions */
	_buildTree( geo, options ) {

		const ctx = new BVHConstructionContext( geo, options );
		const verticesLength = geo.attributes.position.count;
		const indicesLength = ctx.tris.length * 3;
		const indices = new ( verticesLength < 65536 ? Uint16Array : Uint32Array )( indicesLength );

		const createNode = ( bb, newNode, offset, count, depth = 0 ) => {

			const node = newNode || new MeshBVHNode();

			// get the bounds of the triangles
			node.boundingData = boundsToArray( bb );

			// early out wif we've met our capacity
			if ( count <= options.maxLeafNodes ) {

				ctx.writeReorderedIndices( offset, count, indices );
				node.offset = offset;
				node.count = count;
				return node;

			}

			// Find where to split the volume
			const split = ctx.getOptimalSplit( bb, offset, count, options.strategy );
			if ( split.axis === - 1 ) {

				ctx.writeReorderedIndices( offset, count, indices );
				node.offset = offset;
				node.count = count;
				return node;

			}

			const splitOffset = ctx.partition( offset, count, split );

			// create the two new child nodes
			if ( splitOffset === offset || splitOffset === offset + count ) {

				ctx.writeReorderedIndices( offset, count, indices );
				node.offset = offset;
				node.count = count;

			} else if ( depth < options.maxDepth ) {

				node.splitAxis = split.axis;
				node.children = [];

				// create the bounds for the left child, keeping it within the bounds of the parent
				const bl = new THREE.Box3().copy( bb );
				ctx.shrinkBoundsTo( offset, splitOffset - offset, bl );
				node.children.push( createNode( bl, null, offset, splitOffset - offset, depth + 1 ) );

				// repeat for right
				const br = new THREE.Box3().copy( bb );
				ctx.shrinkBoundsTo( splitOffset, offset + count - splitOffset, br );
				node.children.push( createNode( br, null, splitOffset, offset + count - splitOffset, depth + 1 ) );

			}

			return node;

		};

		if ( ! geo.boundingBox ) geo.computeBoundingBox();

		const n = createNode( ( new THREE.Box3() ).copy( geo.boundingBox ), this, 0, ctx.tris.length );
		n.index = indices;
		return n;

	}

}
