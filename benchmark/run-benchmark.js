import * as THREE from 'three';
import { runBenchmark, log, finishLog } from './utils.js';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, getBVHExtremes,
	CENTER, AVERAGE, SAH, estimateMemoryInBytes, MeshBVH, ExtendedTriangle,
} from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const sphere = new THREE.Sphere( undefined, 3 );
const boxMat = new THREE.Matrix4().identity();
const box = new THREE.Box3();
box.min.set( - 1, - 1, - 1 );
box.min.set( 1, 1, 1 );

const intersectGeometry = new THREE.TorusBufferGeometry( 5, 5, 30, 10 );
const geomMat = new THREE.Matrix4().compose( new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3( 0.1, 0.1, 0.1 ) );

const target1 = {};
const target2 = {};

const geometry = new THREE.TorusBufferGeometry( 5, 5, 700, 300 );
const mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );
const raycaster = new THREE.Raycaster();
raycaster.ray.origin.set( 10, 20, 30 );
raycaster.ray.direction.set( - 1, - 2, - 3 );

function logExtremes( bvh ) {

	const extremes = getBVHExtremes( bvh )[ 0 ];
	const bvhSize = estimateMemoryInBytes( bvh._roots );
	const serializedSize = estimateMemoryInBytes( MeshBVH.serialize( bvh ).roots );

	log( `\tExtremes` );
	log( `\t\tmemory`, ` ${ bvhSize / 1000 } kb` );
	log( `\t\tserialized`, ` ${ serializedSize / 1000 } kb` );
	log( `\t\ttotal nodes`, ` ${ extremes.nodeCount }` );
	log( `\t\ttris`, ` ${extremes.tris.min}, ${extremes.tris.max}` );
	log( `\t\tdepth`, ` ${extremes.depth.min}, ${extremes.depth.max}` );
	log( `\t\tsplits`, ` ${extremes.splits[ 0 ]}, ${extremes.splits[ 1 ]}, ${extremes.splits[ 2 ]}` );
	log( `\t\tsurfaceAreaScore`, ` ${extremes.surfaceAreaScore.toFixed( 6 )}` );

}

function runSuite( strategy ) {

	const options = { strategy };
	geometry.computeBoundsTree( options );

	// generate a set of node indices to use with an optimized refit function
	const refitIndices = new Set();
	const newSphere = new THREE.Sphere(
		new THREE.Vector3( 0, 0, 0 ),
		0.5,
	);
	geometry.boundsTree.shapecast( {

		intersectsBounds: ( box, isLeaf, score, depth, nodeIndex ) => {

			if ( box.intersectsSphere( newSphere ) ) {

				refitIndices.add( nodeIndex );
				return true;

			}

			return false;

		}

	} );

	logExtremes( geometry.boundsTree );

	geometry.computeBoundingBox();
	runBenchmark(

		'Compute BVH',
		() => {

			geometry.boundsTree = null;

		},
		() => {

			geometry.computeBoundsTree( options );

		},

	);

	const tempBox = new THREE.Box3();
	runBenchmark(

		'Compute BB w/ BVH',
		null,
		() => {

			geometry.boundsTree.getBoundingBox( tempBox );

		},

	);

	runBenchmark(

		'Compute BB w/o BVH',
		null,
		() => {

			geometry.computeBoundingBox();

		},

	);

	runBenchmark(

		'Refit',
		null,
		() => {

			geometry.boundsTree.refit();

		},

	);

	runBenchmark(

		'Refit w/ hints',
		null,
		() => {

			geometry.boundsTree.refit( refitIndices );


		},

	);

	runBenchmark(

		'Serialize',
		null,
		() => {

			MeshBVH.serialize( geometry.boundsTree );

		},

	);

	const serialized = MeshBVH.serialize( geometry.boundsTree );
	runBenchmark(

		'Deserialize',
		null,
		() => {

			MeshBVH.deserialize( serialized, geometry );

		},

	);

	geometry.computeBoundsTree( options );
	raycaster.firstHitOnly = false;
	runBenchmark(

		'BVH Raycast',
		null,
		() => mesh.raycast( raycaster, [] )

	);

	raycaster.firstHitOnly = true;
	runBenchmark(

		'First Hit Raycast',
		null,
		() => mesh.raycast( raycaster, [] )

	);

	runBenchmark(

		'Sphere Shapecast',
		null,
		() => {

			mesh.geometry.boundsTree.shapecast( {

				intersectsBounds: box => sphere.intersectsBox( box ),

				intersectsTriangle: tri => {

					tri.intersectsSphere( sphere );

				},

			} );

		}

	);

	runBenchmark(

		'IntersectsSphere',
		null,
		() => mesh.geometry.boundsTree.intersectsSphere( sphere )

	);

	runBenchmark(

		'IntersectsBox',
		null,
		() => mesh.geometry.boundsTree.intersectsBox( box, boxMat )

	);

	runBenchmark(

		'DistanceToGeometry w/ BVH',
		null,
		() => mesh.geometry.boundsTree.closestPointToGeometry( intersectGeometry, geomMat, target1, target2 ).distance

	);

	const vec = new THREE.Vector3();
	runBenchmark(

		'DistanceToPoint',
		null,
		() => mesh.geometry.boundsTree.closestPointToPoint( vec, target1 ).distance

	);

	log( '' );

	runBenchmark(

		'IntersectsGeometry w/ BVH',
		null,
		() => mesh.geometry.boundsTree.intersectsGeometry( intersectGeometry, geomMat )

	);


	intersectGeometry.disposeBoundsTree();
	runBenchmark(

		'IntersectsGeometry w/o BVH',
		null,
		() => mesh.geometry.boundsTree.intersectsGeometry( intersectGeometry, geomMat )

	);

}

function mathFunctions() {

	const tri1 = new ExtendedTriangle();
	const tri2 = new ExtendedTriangle();
	const target = new THREE.Line3();

	tri1.a.set( - 1, 0, 0 );
	tri1.b.set( 2, 0, - 2 );
	tri1.c.set( 2, 0, 2 );

	tri2.a.set( 1, 0, 0 );
	tri2.b.set( - 2, - 2, 0 );
	tri2.c.set( - 2, 2, 0 );

	tri1.update();
	tri2.update();

	runBenchmark(

		'IntersectTri w/o Target',
		null,
		() => {

			tri1.intersectsTriangle( tri2 );

		}

	);

	runBenchmark(

		'IntersectTri w/ Target',
		null,
		() => {

			tri1.intersectsTriangle( tri2, target );

		}

	);

	runBenchmark(

		'IntersectTri w/ Update',
		null,
		() => {

			tri2.needsUpdate = true;
			tri1.intersectsTriangle( tri2, target );

		}

	);

}

log( '*Math*' );
mathFunctions();

log( '' );
log( '*Strategy: CENTER*' );
runSuite( CENTER );

log( '' );
log( '*Strategy: AVERAGE*' );
runSuite( AVERAGE );

log( '' );
log( '*Strategy: SAH*' );
runSuite( SAH );

//

log( '' );
log( '*Strategy: NONE*' );

geometry.boundsTree = null;
raycaster.firstHitOnly = false;
runBenchmark(

	'Default Raycast',
	null,
	() => mesh.raycast( raycaster, [] )

);


log( '' );

log( 'Extreme Case Tower Geometry' );

const towerGeometry = new THREE.PlaneBufferGeometry( 10, 10, 400, 400 );
const posAttr = towerGeometry.getAttribute( 'position' );
for ( let x = 0; x <= 100; x ++ ) {

	for ( let y = 0; y <= 100; y ++ ) {

		const inCenter = x > 100 && x < 300 && y > 100 && y < 300;
		const i = x * 100 + y;
		const z = inCenter ? 50 : - 50;
		posAttr.setZ( i, z + x * 0.01 );

	}

}

raycaster.firstHitOnly = false;
raycaster.ray.origin.set( 100, 100, 100 );
raycaster.ray.direction.set( - 1, - 1, - 1 );
mesh.geometry = towerGeometry;

towerGeometry.computeBoundsTree( { strategy: CENTER } );
runBenchmark(

	'CENTER raycast',
	null,
	() => mesh.raycast( raycaster, [] )

);
logExtremes( towerGeometry.boundsTree );

towerGeometry.computeBoundsTree( { strategy: AVERAGE } );
runBenchmark(

	'AVERAGE raycast',
	null,
	() => mesh.raycast( raycaster, [] )

);
logExtremes( towerGeometry.boundsTree );

towerGeometry.computeBoundsTree( { strategy: SAH } );
runBenchmark(

	'SAH raycast',
	null,
	() => mesh.raycast( raycaster, [] )

);
logExtremes( towerGeometry.boundsTree );

finishLog();
