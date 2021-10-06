import * as THREE from 'three';
import {MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast, 
  validateBounds} from '../src/index.js';

beforeAll(() => {
  // Should be able to overide THREE function without issue
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
});


describe("Bounds Tree", () => {
  test('should create from within mesh', () => {
    const geom = new THREE.SphereBufferGeometry(500, 50, 50);
    geom.computeBoundsTree();
    
    expect(geom.boundsTree).not.toBeNull();
    expect(validateBounds(geom.boundsTree!)).toBeTruthy();
  }); 

  test('should manually create tree', () => {
    const geom = new THREE.SphereBufferGeometry(500, 50, 50);
    const bvh = new MeshBVH(geom);

    expect(validateBounds(bvh)).toBeTruthy();
  }); 
});
 

