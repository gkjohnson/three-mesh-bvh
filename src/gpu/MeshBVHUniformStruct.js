import {
	DataTexture,
	FloatType,
	UnsignedIntType,
	RGBFormat,
	RGFormat,
	NearestFilter,
} from 'three';
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

	// Both bounds need two elements per node so compute the height so it's twice as long as
	// the width so we can expand the row by two and still have a square texture
	const nodeCount = root.byteLength / BYTES_PER_NODE;
	const boundsDimension = 2 * Math.ceil( Math.sqrt( nodeCount / 2 ) );
	const boundsArray = new Float32Array( 3 * boundsDimension * boundsDimension );

	const contentsDimension = 2 * Math.ceil( Math.sqrt( nodeCount / 2 ) );
	const contentsArray = new Uint32Array( 2 * contentsDimension * contentsDimension );

	for ( let i = 0; i < nodeCount; i ++ ) {

		const nodeIndex = i * BYTES_PER_NODE / 4;
		const boundsIndex = BOUNDING_DATA_INDEX( nodeIndex );
		for ( let b = 0; b < 6; b ++ ) {

			boundsArray[ 6 * i + b ] = float32Array[ boundsIndex + b ];

		}

		if ( IS_LEAF( nodeIndex, uint16Array ) ) {

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

	boundsTexture.image.data = boundsArray;
	boundsTexture.image.width = boundsDimension;
	boundsTexture.image.height = boundsDimension;
	boundsTexture.format = RGBFormat;
	boundsTexture.type = FloatType;
	boundsTexture.internalFormat = 'RGB32F';
	boundsTexture.minFilter = NearestFilter;
	boundsTexture.magFilter = NearestFilter;
	boundsTexture.generateMipmaps = false;
	boundsTexture.needsUpdate = true;

	contentsTexture.image.data = contentsArray;
	contentsTexture.image.width = contentsDimension;
	contentsTexture.image.height = contentsDimension;
	contentsTexture.format = RGFormat;
	contentsTexture.type = UnsignedIntType;
	contentsTexture.internalFormat = 'RG32UI';
	contentsTexture.minFilter = NearestFilter;
	contentsTexture.magFilter = NearestFilter;
	contentsTexture.generateMipmaps = false;
	contentsTexture.needsUpdate = true;

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
