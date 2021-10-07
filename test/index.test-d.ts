import { BufferGeometry, Mesh, TorusBufferGeometry, Box3, Raycaster, FrontSide,
  Ray, Material, Intersection, Matrix4, Sphere } from 'three';
import { MeshBVH, MeshBVHOptions } from '../src/index';
import { expectType, expectNotType } from 'tsd';

const geometry = new TorusBufferGeometry( 5, 5, 400, 100 );
const mesh = new Mesh( geometry );
const bvh = new MeshBVH( mesh.geometry );
const box = new Box3();
const ray = new Ray();
const matrix4 = new Matrix4();
const sphere = new Sphere();
const material = new Material();
const raycaster = new Raycaster();

// Modules augmentation
{

  // Buffer Geomtry
  {

    expectNotType<MeshBVH>( geometry.boundsTree );
    expectType<( opt?: MeshBVHOptions ) => void>( geometry.computeBoundsTree );

    geometry.computeBoundsTree();
    expectType<MeshBVH>( geometry.boundsTree! );
    expectType<() => void>( geometry.disposeBoundsTree );

    geometry.disposeBoundsTree();
    expectNotType<MeshBVH>( geometry.boundsTree );

  }

  // Raycaster
  {

    expectNotType<boolean>( raycaster.firstHitOnly );

    Raycaster.prototype.firstHitOnly = false;
    expectType<boolean>( raycaster.firstHitOnly! );

  }

}

// MeshBVH
{

  // Contructor
  expectType<MeshBVH>( bvh );
  expectType<BufferGeometry>( bvh.geometry );

  // Bounding box
  expectType<Box3>( bvh.getBoundingBox( box ) );

  // Raycast
  expectType<Array<Intersection>>( bvh.raycast( ray, material ) );
  expectType<Array<Intersection>>( bvh.raycast( ray, FrontSide ) );

  // Raycast First
  expectType<Intersection>( bvh.raycastFirst( ray, material ) );
  expectType<Intersection>( bvh.raycastFirst( ray, FrontSide ) );

  // Intersections
  expectType<boolean>( bvh.intersectsBox( box, matrix4 ) );
  expectType<boolean>( bvh.intersectsSphere( sphere ) );
  expectType<boolean>( bvh.intersectsGeometry( geometry, matrix4 ) );

}
