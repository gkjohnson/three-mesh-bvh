import { MeshBVH, BVHOptions } from '../index.js';
import { BufferGeometry } from 'three';

export interface GenerateMeshBVHWorkerOptions {

	useBundledWorker?: boolean;

}

export class GenerateMeshBVHWorker {

	constructor( options?: GenerateMeshBVHWorkerOptions );

	readonly running: boolean;
	readonly useBundledWorker: boolean;

	generate( geometry: BufferGeometry, options?: BVHOptions ): Promise<MeshBVH>;
	dispose(): void;

}

export class ParallelMeshBVHWorker extends GenerateMeshBVHWorker {

	maxWorkerCount: number;

}
