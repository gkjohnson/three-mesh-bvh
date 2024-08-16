import { BufferGeometry, Mesh, Raycaster, BatchedMesh } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
BatchedMesh.prototype.computeBoundsTree = computeBoundsTree;
BatchedMesh.prototype.disposeBoundsTree = disposeBoundsTree;

const mesh = new Mesh();
mesh.geometry.computeBoundsTree();
mesh.geometry.disposeBoundsTree();

const batchedMesh = new BatchedMesh( 1, 1, 1 );
batchedMesh.computeBoundsTree();
batchedMesh.disposeBoundsTree();

const raycaster = new Raycaster();
raycaster.firstHitOnly = true;

mesh.raycast( raycaster, [] );
