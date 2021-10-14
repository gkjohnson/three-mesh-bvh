import { BufferGeometry, Mesh, Raycaster } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const mesh = new Mesh();
mesh.geometry.computeBoundsTree();
mesh.geometry.disposeBoundsTree();
mesh.raycast( new Raycaster(), [] );
