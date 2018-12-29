import * as THREE from 'three';
import MeshBVHNode from './MeshBVHNode.js';
import BVHConstructionContext from './BVHConstructionContext.js';
import { boundsToArray } from './BoundsUtilities.js';
import { CENTER } from './Constants.js';

export default class MeshBVH extends MeshBVHNode {

	constructor( geo, options = {} ) {

		super();

		// default options
		options = Object.assign( {

			strategy: CENTER,
			maxDepth: Infinity,
			maxLeafTris: 10

		}, options );
		options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

		if ( geo.isBufferGeometry ) {

			this._root = this._buildTree( geo, options );

		} else {

			throw new Error( 'Only BufferGeometries are supported.' );

		}

	}

	/* Private Functions */

	_ensureIndex( geo ) {

		if ( ! geo.index ) {

			const triCount = geo.attributes.position.count / 3;
			const indexCount = triCount * 3;
			const index = new ( triCount > 65535 ? Uint32Array : Uint16Array )( indexCount );
			for ( let i = 0; i < indexCount; i ++ ) {
				index[ i ] = i;
			}
			geo.setIndex( new THREE.BufferAttribute( index, 1 ) );

		}

	}

	_buildTree( geo, options ) {

		this._ensureIndex( geo );

		const ctx = new BVHConstructionContext( geo, options );

		// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
		// recording the offset and count of its triangles and writing them into the reordered geometry index.
		const splitNode = ( node, offset, count, depth = 0 ) => {

			// early out if we've met our capacity
			if ( count <= options.maxLeafTris || depth >= options.maxDepth ) {

				node.offset = offset;
				node.count = count;
				return node;

			}

			// Find where to split the volume
			const split = ctx.getOptimalSplit( node.boundingData, offset, count, options.strategy );
			if ( split.axis === - 1 ) {

				node.offset = offset;
				node.count = count;
				return node;

			}

			const splitOffset = ctx.partition( offset, count, split );

			// create the two new child nodes
			if ( splitOffset === offset || splitOffset === offset + count ) {

				node.offset = offset;
				node.count = count;

			} else {

				// create the left child and compute its bounding box
				const left = new MeshBVHNode();
				const lstart = offset, lcount = splitOffset - offset;
				left.boundingData = ctx.getBounds( lstart, lcount, new Float32Array( 6 ) );
				splitNode( left, lstart, lcount, depth + 1 );

				// repeat for right
				const right = new MeshBVHNode();
				const rstart = splitOffset, rcount = count - lcount;
				right.boundingData = ctx.getBounds( rstart, rcount, new Float32Array( 6 ) );
				splitNode( right, rstart, rcount, depth + 1 );

				node.splitAxis = split.axis;
				node.children = [ left, right ];

			}

			return node;

		};

		if ( ! geo.boundingBox ) geo.computeBoundingBox();

		this.boundingData = boundsToArray( geo.boundingBox );
		splitNode( this, 0, geo.index.count / 3 );

		return this;

	}

}
