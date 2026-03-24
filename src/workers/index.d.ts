import { MeshBVH, BVHOptions } from '../index.js';
import { BufferGeometry } from 'three';

export class GenerateMeshBVHWorker {

	readonly running: boolean;

	generate( geometry: BufferGeometry, options?: BVHOptions ): Promise<MeshBVH>;
	dispose(): void;

}

export class ParallelMeshBVHWorker extends GenerateMeshBVHWorker {

	maxWorkerCount: number;

}
