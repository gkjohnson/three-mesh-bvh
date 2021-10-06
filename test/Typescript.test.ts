import {
  Mesh,
  BufferGeometry,
  Raycaster,
  MeshBasicMaterial,
  TorusBufferGeometry,
} from 'three';
import {MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast, 
  validateBounds, CENTER, getBVHExtremes} from '../src/index.js';

// Returns the max tree depth of the BVH
function getMaxDepth( bvh: MeshBVH ) {
  return getBVHExtremes( bvh )[ 0 ].depth.max;
}

beforeAll(() => {
  // Should be able to overide THREE function without issue
  BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  Mesh.prototype.raycast = acceleratedRaycast;
});

describe("Mesh BVH", () => {

  let mesh: Mesh;
  beforeAll( () => {
    const geometry = new TorusBufferGeometry( 5, 5, 400, 100 );
    mesh = new Mesh( geometry, new MeshBasicMaterial() );
  } );

  test('should create from within mesh', () => {
    mesh.geometry.computeBoundsTree();
    
    expect(mesh.geometry.boundsTree).not.toBeNull();
    expect(validateBounds(mesh.geometry.boundsTree!)).toBeTruthy();
  }); 

  test('should manually create tree', () => {
    const bvh = new MeshBVH(mesh.geometry);
    
    expect(validateBounds(bvh)).toBeTruthy();
  }); 

  test('Mesh BVH options', () => {
    mesh.geometry.boundingBox = null;
    mesh.geometry.computeBoundsTree({
      setBoundingBox: true,
      maxDepth: 10, 
      verbose: false,
      useSharedArrayBuffer: true,
      strategy: CENTER,
    });
    const depth = getMaxDepth(mesh.geometry.boundsTree!);
    expect( mesh.geometry.boundingBox ).not.toBe( null );
    expect( depth ).toEqual( 10 );
  });

  test('raycast func', () => {
    const raycaster = new Raycaster();
    raycaster.ray.origin.set( 0, 0, 10 );
    raycaster.ray.direction.set( 0, 0, -1);

    const bvh = new MeshBVH( mesh.geometry, { maxDepth: 3, verbose: false } );
    const ogHits = raycaster.intersectObject( mesh, true );

    mesh.geometry.boundsTree = bvh;
    const bvhHits = raycaster.intersectObject( mesh, true );

    raycaster.firstHitOnly = true;
    const firstHit = raycaster.intersectObject( mesh, true );

    expect( ogHits ).toEqual( bvhHits );
    expect( firstHit[ 0 ] ).toEqual( ogHits[ 0 ] );

  });

 
});

 

