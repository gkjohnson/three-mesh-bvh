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
			maxDepth: 40,
			maxLeafTris: 10,
			verbose: true

		}, options );
		options.strategy = Math.max( 0, Math.min( 2, options.strategy ) );

		if ( geo.isBufferGeometry ) {

			this._root = this._buildTree( geo, options );

		} else {

			throw new Error( 'MeshBVH: Only BufferGeometries are supported.' );

		}

	}

	/* Private Functions */

	_ensureIndex( geo ) {

		if ( ! geo.index ) {

			const triCount = geo.attributes.position.count / 3;
			const indexCount = triCount * 3;
			const index = new ( triCount > 65535 ? Uint32Array : Uint16Array )( indexCount );
			geo.setIndex( new THREE.BufferAttribute( index, 1 ) );

			for ( let i = 0; i < indexCount; i ++ ) {

				index[ i ] = i;

			}

		}

	}

	_buildTree( geo, options ) {

		this._ensureIndex( geo );

		const ctx = new BVHConstructionContext( geo, options );
		let reachedMaxDepth = false;

		// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
		// recording the offset and count of its triangles and writing them into the reordered geometry index.
		const splitNode = ( node, offset, count, depth = 0 ) => {

			if ( depth >= options.maxDepth ) {

				reachedMaxDepth = true;

			}

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

				node.splitAxis = split.axis;

				// create the left child and compute its bounding box
				const left = node.left = new MeshBVHNode();
				const lstart = offset, lcount = splitOffset - offset;
				left.boundingData = ctx.getBounds( lstart, lcount, new Float32Array( 6 ) );
				splitNode( left, lstart, lcount, depth + 1 );

				// repeat for right
				const right = node.right = new MeshBVHNode();
				const rstart = splitOffset, rcount = count - lcount;
				right.boundingData = ctx.getBounds( rstart, rcount, new Float32Array( 6 ) );
				splitNode( right, rstart, rcount, depth + 1 );

			}

			return node;

		};

		if ( ! geo.boundingBox ) geo.computeBoundingBox();
		this.boundingData = boundsToArray( geo.boundingBox );
		splitNode( this, 0, geo.index.count / 3 );

		if ( reachedMaxDepth && options.verbose ) {

			console.warn( `MeshBVH: Max depth of ${ options.maxDepth } reached when generating BVH. Consider increasing maxDepth.` );
			console.warn( this, geo );

		}

		return this;

	}

}
