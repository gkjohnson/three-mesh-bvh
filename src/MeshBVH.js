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
	_buildTree( geo, options ) {

		const ctx = new BVHConstructionContext( geo, options );
		const verticesLength = geo.attributes.position.count;
		const indicesLength = ctx.tris.length * 3;
		const indices = new ( verticesLength < 65536 ? Uint16Array : Uint32Array )( indicesLength );
		let reachedMaxDepth = false;

		// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
		// recording the offset and count of its triangles and writing them into the reordered geometry index.
		const splitNode = ( node, offset, count, depth = 0 ) => {

			if ( depth >= options.maxDepth ) {

				reachedMaxDepth = true;

			}

			// early out if we've met our capacity
			if ( count <= options.maxLeafTris || depth >= options.maxDepth ) {

				ctx.writeReorderedIndices( offset, count, indices );
				node.offset = offset;
				node.count = count;
				return node;

			}

			// Find where to split the volume
			const split = ctx.getOptimalSplit( node.boundingData, offset, count, options.strategy );
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
		this.index = new THREE.BufferAttribute( indices, 1 );
		splitNode( this, 0, ctx.tris.length );

		if ( reachedMaxDepth && options.verbose ) {

			console.warn( `MeshBVH: Max depth of ${ options.maxDepth } reached when generating BVH. Consider increasing maxDepth.` );
			console.warn( this, geo );

		}

		return this;

	}

}
