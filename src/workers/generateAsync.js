import { GenerateMeshBVHWorker } from './GenerateMeshBVHWorker.js';

export function generateAsync( geometry, options = {} ) {

	console.warn( 'MeshBVH: "generateAsync" is deprecated. Use MeshBVHGenerationWorker instead.' );

	return new GenerateMeshBVHWorker().generate( geometry, options );

}
