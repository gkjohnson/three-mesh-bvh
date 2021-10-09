import { DataTexture } from 'three';
import {
	FloatVertexAttributeTexture,
	UnsignedIntVertexAttributeTexture,
} from './VertexAttributeTexture.js';
import { BYTES_PER_NODE } from '../core/Constants.js';
import {
	BOUNDING_DATA_INDEX,
	COUNT,
	IS_LEAF,
	LEFT_NODE,
	OFFSET,
	RIGHT_NODE,
	SPLIT_AXIS,
} from '../core/nodeBufferFunctions.js';

function bvhToTextures( bvh, boundsTexture, contentsTexture ) {

	const roots = bvh._roots;

	if ( roots.length !== 1 ) {

		throw new Error( 'MeshBVHUniformStruct: Multi-root BVHs not supported.' );

	}

	const root = roots[ 0 ];
	const uint16Array = new Uint16Array( root );
	const uint32Array = new Uint32Array( root );
	const float32Array = new Float32Array( root );

	const nodeCount = root.length / BYTES_PER_NODE;
	const boundsDimension = Math.ceil( Math.sqrt( nodeCount / 2 ) );
	const boundsArray = new Float32Array( 2 * 2 * boundsDimension * boundsDimension );

	const contentsDimension = Math.ceil( Math.ceil( nodeCount / 2 ) );
	const contentsArray = new Uint32Array( 2 * 2 * contentsDimension * contentsDimension );

	for ( let i = 0; i < nodeCount; i ++ ) {

		// TODO: adjust the original buffer to not store data in bytes
		const nodeIndex = i * BYTES_PER_NODE;
		const boundsIndex = BOUNDING_DATA_INDEX( nodeIndex );
		for ( let b = 0; b < 6; b ++ ) {

			boundsArray[ b ] = float32Array[ boundsIndex + b ];

		}

		if ( IS_LEAF( nodeIndex ) ) {

			const count = COUNT( nodeIndex * 2, uint16Array );
			const offset = OFFSET( nodeIndex, uint32Array );

			const mergedLeafCount = 0xffff0000 | count;
			contentsArray[ i * 2 + 0 ] = mergedLeafCount;
			contentsArray[ i * 2 + 1 ] = offset;

		} else {

			// const rightIndex = RIGHT_NODE( nodeIndex, uint32Array ) / BYTES_PER_NODE;
			const leftIndex = LEFT_NODE( nodeIndex ) / BYTES_PER_NODE;
			const splitAxis = SPLIT_AXIS( nodeIndex, uint32Array );

			contentsArray[ i * 2 + 0 ] = leftIndex;
			contentsArray[ i * 2 + 1 ] = splitAxis;

		}

	}

}

export class MeshBVHUniformStruct {

	constructor() {

		this.autoDispose = true;
		this.index = new UnsignedIntVertexAttributeTexture();
		this.position = new FloatVertexAttributeTexture();
		this.bvhBounds = new DataTexture();
		this.bvhContents = new DataTexture();

	}

	updateFrom( bvh ) {

		const { geometry } = bvh;

		bvhToTextures( bvh, this.bvhBounds, this.bvhContents );

		this.index.updateFrom( geometry.index );
		this.position.updateFrom( geometry.attributes.position );

	}

	dispose() {

		const { index, position, bvhBounds, bvhContents } = this;

		if ( index ) index.dispose();
		if ( position ) position.dispose();
		if ( bvhBounds ) bvhBounds.dispose();
		if ( bvhContents ) bvhContents.dispose();

	}

}
