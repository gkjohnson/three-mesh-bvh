import { BufferGeometry, Mesh, TorusBufferGeometry, Box3, Raycaster, FrontSide,
  Ray, Material, Intersection, Matrix4, Sphere, LineBasicMaterial, MeshBasicMaterial,
  Color } from 'three';
import { MeshBVH, MeshBVHOptions, SerializedBVH, MeshBVHVisualizer, INTERSECTED,
  SeparatingAxisTriangle
} from '../src/index';
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
  expectType<Intersection>( bvh.raycastFirst( ray, material ) );
  expectType<Intersection>( bvh.raycastFirst( ray, FrontSide ) );

  // Intersections
  expectType<boolean>( bvh.intersectsBox( box, matrix4 ) );
  expectType<boolean>( bvh.intersectsSphere( sphere ) );
  expectType<boolean>( bvh.intersectsGeometry( geometry, matrix4 ) );

  // Callback functions
  expectType<void>(
    bvh.traverse( ( depth, isLeaf, boundingData, offsetOrSplit, count ) => {

      expectType<number>( depth );
      expectType<boolean>( isLeaf );
      expectType<ArrayBuffer>( boundingData );
      expectType<number>( offsetOrSplit );
      expectType<number>( count );

    } )
  );

  expectType<boolean>(
    bvh.shapecast( {

      traverseBoundsOrder: ( box ) => {

        expectType<Box3>( box );
        return 99;

      },
      intersectsBounds: ( box, isLeaf, score, depth, nodeIndex ) => {

        expectType<Box3>( box );
        expectType<boolean>( isLeaf );
        expectType<number | undefined>( score );
        expectType<number>( depth );
        expectType<number>( nodeIndex );
        return INTERSECTED;

      },
      intersectsRange: ( triOffset, triCount, contained, depth, nodeIndex, box ) => {

        expectType<number>( triOffset );
        expectType<number>( triCount );
        expectType<boolean>( contained );
        expectType<number>( depth );
        expectType<number>( nodeIndex );
        expectType<Box3>( box );
        return true;

      },
      intersectsTriangle: ( triangle, triangleIndex, contained, depth ) => {

        expectType<SeparatingAxisTriangle>( triangle );
        expectType<number>( triangleIndex );
        expectType<boolean>( contained );
        expectType<number>( depth );
        return true;

      }
    } )
  );

  expectType<boolean>(
    bvh.bvhcast(
      bvh,
      matrix4,
      {

        intersectsRanges: ( offset1, count1, offset2, count2, depth1, index1, depth2, index2 ) => {

          expectType<number>( offset1 );
          expectType<number>( count1 );
          expectType<number>( offset2 );
          expectType<number>( count2 );
          expectType<number>( depth1 );
          expectType<number>( index1 );
          expectType<number>( depth2 );
          expectType<number>( index2 );
          return true;

        },

        intersectsTriangles: ( triangle1, triangle2, i1, i2, depth1, index1, depth2, index2 ) => {

          expectType<SeparatingAxisTriangle>( triangle1 );
          expectType<SeparatingAxisTriangle>( triangle2 );
          expectType<number>( i1 );
          expectType<number>( i2 );
          expectType<number>( depth1 );
          expectType<number>( index1 );
          expectType<number>( depth2 );
          expectType<number>( index2 );
          return true;

        },

      }
    )
  );

}

// SerializedBVH
{

  const data = MeshBVH.serialize( bvh );
  expectType<SerializedBVH>( data );
  expectType<Array<ArrayBuffer>>( data.roots );
  expectType<ArrayBufferView>( data.index );

  const deserializedBVH = MeshBVH.deserialize( data, bvh.geometry );
  expectType<MeshBVH>( deserializedBVH );

}

// MeshBVHVisualizer
{

  const visualizer = new MeshBVHVisualizer( mesh, 20 );
  expectType<number>( visualizer.depth );
  expectType<boolean>( visualizer.displayParents );
  expectType<boolean>( visualizer.displayEdges );
  expectType<LineBasicMaterial>( visualizer.edgeMaterial );
  expectType<MeshBasicMaterial>( visualizer.meshMaterial );

  expectType<Color>( visualizer.color );

  visualizer.opacity = 10;
  expectType<number>( visualizer.opacity );

  expectType<MeshBVHVisualizer>( visualizer.clone() );

  expectType<void>( visualizer.copy( visualizer ) );

}
