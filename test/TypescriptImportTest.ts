import { BufferGeometry, Mesh, Raycaster, BatchedMesh } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, computeBatchedBoundsTree, disposeBatchedBoundsTree } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker, ParallelMeshBVHWorker } from 'three-mesh-bvh/worker';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

BatchedMesh.prototype.raycast = acceleratedRaycast;
BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;

const mesh = new Mesh();
mesh.geometry.computeBoundsTree();
mesh.geometry.disposeBoundsTree();

const batchedMesh = new BatchedMesh( 1, 1, 1 );
batchedMesh.computeBoundsTree();
batchedMesh.disposeBoundsTree();

const raycaster = new Raycaster();
raycaster.firstHitOnly = true;

mesh.raycast( raycaster, [] );

const worker = new GenerateMeshBVHWorker( { useBundledWorker: true } );
worker.generate( mesh.geometry ).then( bvh => {

	mesh.geometry.boundsTree = bvh;

} );

const parallelWorker = new ParallelMeshBVHWorker( { useBundledWorker: true } );
const bundledWorker = new GenerateMeshBVHWorker( { useBundledWorker: parallelWorker.useBundledWorker } );
bundledWorker.dispose();
parallelWorker.dispose();
