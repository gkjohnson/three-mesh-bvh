import { DataTexture } from 'three';
import {
	FloatVertexAttributeTexture,
	UnsignedIntVertexAttributeTexture,
} from './VertexAttributeTexture.js';

function bvhToTextures( bvh, boundsTexture, contentsTexture ) {



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

		this.index.updateFrom( geometry.index );
		this.position.updateFrom( geometry.attributes.position );

		bvhToTextures( bvh, this.bvhBounds, this.bvhContents );

	}

	dispose() {

		const { index, position, bvhBounds, bvhContents } = this;

		if ( index ) index.dispose();
		if ( position ) position.dispose();
		if ( bvhBounds ) bvhBounds.dispose();
		if ( bvhContents ) bvhContents.dispose();

	}

}
