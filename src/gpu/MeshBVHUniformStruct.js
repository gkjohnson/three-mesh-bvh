export class MeshBVHUniformStruct {

	constructor() {

		this.autoDispose = true;
		this.index = null;
		this.position = null;
		this.bvhBounds = null;
		this.bvhContents = null;

	}

	updateFrom( bvh ) {

	}

	dispose() {

		const { index, position, bvhBounds, bvhContents } = this;

		if ( index ) index.dispose();
		if ( position ) position.dispose();
		if ( bvhBounds ) bvhBounds.dispose();
		if ( bvhContents ) bvhContents.dispose();

	}

}
