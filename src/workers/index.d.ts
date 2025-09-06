import { MeshBVH, MeshBVHOptions } from '../index.js';
import { BufferGeometry } from 'three';

export class GenerateMeshBVHWorker {

	generate( geometry: BufferGeometry, options: MeshBVHOptions ): Promise<MeshBVH>;

}

export class ParallelBVHWorker extends GenerateMeshBVHWorker {

	maxWorkerCount: number;

}
