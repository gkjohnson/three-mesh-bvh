import {
	Mesh,
	BufferGeometry,
	TorusGeometry,
	Scene,
	Raycaster,
	MeshBasicMaterial,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	InstancedMesh,
	Object3D,
	BatchedMesh,
	SphereGeometry
} from 'three';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	computeBatchedBoundsTree,
	disposeBatchedBoundsTree,
} from '../src/index.js';
import { random, runTestMatrix, setSeed } from './utils.js';
import { REVISION } from 'three';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
BatchedMesh.prototype.raycast = acceleratedRaycast;
BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;

runTestMatrix( {
	interleaved: [ true, false ],
	near: [ undefined, 6 ],
	far: [ undefined, 7 ],
	batched: [ true, false ],
	onlyOneGeo: [ true, false ],
}, ( desc, options ) => {

	// Batched logic can only work in 166 onward
	// TODO: remove condition in future release
	const IS_REVISION_166 = parseInt( REVISION ) >= 166;
	if ( ! options.batched || IS_REVISION_166 ) {

		describe( `Running with Options: { ${ desc } }`, () => runRandomTests( options ) );

	}

} );

function runRandomTests( options ) {

	const transformSeed = Math.floor( Math.random() * 1e10 );
	describe( `Transform Seed : ${ transformSeed }`, () => {

		let scene,
			raycaster,
			ungroupedGeometry,
			ungroupedBvh,
			groupedGeometry,
			groupedBvh,
			batchedMesh,
			batchedMeshBvh;

		beforeAll( () => {

			ungroupedGeometry = new TorusGeometry( 1, 1, 40, 10 );
			groupedGeometry = new TorusGeometry( 1, 1, 40, 10 );

			if ( options.interleaved ) {

				ungroupedGeometry.setAttribute( 'position', createInterleavedPositionBuffer( ungroupedGeometry.attributes.position ) );
				groupedGeometry.setAttribute( 'position', createInterleavedPositionBuffer( groupedGeometry.attributes.position ) );

			}

			const groupCount = 10;
			const groupSize = groupedGeometry.index.array.length / groupCount;

			for ( let g = 0; g < groupCount; g ++ ) {

				const groupStart = g * groupSize;
				groupedGeometry.addGroup( groupStart, groupSize, 0 );

			}

			groupedGeometry.computeBoundsTree( options );
			ungroupedGeometry.computeBoundsTree( options );

			ungroupedBvh = ungroupedGeometry.boundsTree;
			groupedBvh = groupedGeometry.boundsTree;

			scene = new Scene();
			raycaster = new Raycaster();

			if ( options.near !== undefined ) {

				raycaster.near = options.near;

			}

			if ( options.far !== undefined ) {

				raycaster.far = options.far;

			}

			setSeed( transformSeed );
			random(); // call random() to seed with a larger value

			if ( options.instanced ) {

				const geo = groupedGeometry; // ungroupedGeometry not used...
				const instancedMesh = new InstancedMesh( geo, new MeshBasicMaterial(), 10 );
				randomizeObjectTransform( instancedMesh, true );
				scene.add( instancedMesh );

				const tempObj = new Object3D();

				for ( let i = 0; i < 10; i ++ ) {

					randomizeObjectTransform( tempObj );
					instancedMesh.setMatrixAt( i, tempObj.matrix );

				}

			} else if ( options.batched ) {

				const geo = ungroupedGeometry;
				const geo2 = new SphereGeometry( 1, 32, 16 );
				const count = geo.attributes.position.count + geo2.attributes.position.count;
				const indexCount = geo.index.count + geo2.index.count;
				batchedMesh = new BatchedMesh( 10, count, indexCount, new MeshBasicMaterial() );
				randomizeObjectTransform( batchedMesh, true );
				scene.add( batchedMesh );

				const geoId = batchedMesh.addGeometry( geo );
				if ( options.onlyOneGeo ) {

					batchedMesh.computeBoundsTree( - 1, options );

				}

				const geo2Id = batchedMesh.addGeometry( geo2 );
				if ( ! options.onlyOneGeo ) {

					batchedMesh.computeBoundsTree( - 1, options );

				}

				const tempObj = new Object3D();

				for ( let i = 0; i < 10; i ++ ) {

					randomizeObjectTransform( tempObj );
					const id = batchedMesh.addInstance( i % 2 == 0 ? geoId : geo2Id );
					batchedMesh.setMatrixAt( id, tempObj.matrix );

				}

				batchedMeshBvh = batchedMesh.boundsTrees;

			} else {

				for ( let i = 0; i < 10; i ++ ) {

					let geo = i % 2 ? groupedGeometry : ungroupedGeometry;
					let mesh = new Mesh( geo, new MeshBasicMaterial() );

					randomizeObjectTransform( mesh );
					scene.add( mesh );

				}

			}

		} );

		for ( let i = 0; i < 100; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				setSeed( raySeed );
				random(); // call random() to seed with a larger value

				raycaster.firstHitOnly = false;
				raycaster.ray.origin.set( random() * 10, random() * 10, random() * 10 );
				raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

				ungroupedGeometry.boundsTree = ungroupedBvh;
				groupedGeometry.boundsTree = groupedBvh;
				if ( batchedMesh ) batchedMesh.boundsTrees = batchedMeshBvh;

				const bvhHits = raycaster.intersectObject( scene, true );

				raycaster.firstHitOnly = true;
				const firstHit = raycaster.intersectObject( scene, true );

				ungroupedGeometry.boundsTree = null;
				groupedGeometry.boundsTree = null;
				if ( batchedMesh ) batchedMesh.boundsTrees = null;
				const ogHits = raycaster.intersectObject( scene, true );

				expect( ogHits ).toEqual( bvhHits );
				expect( firstHit[ 0 ] ).toEqual( ogHits[ 0 ] );

			} );

		}

	} );

}

function createInterleavedPositionBuffer( bufferAttribute ) {

	const array = bufferAttribute.array;
	const newArray = new array.constructor( array.length * 2 );
	const newBuffer = new InterleavedBufferAttribute( new InterleavedBuffer( newArray, 6 ), 3, 3, bufferAttribute.normalized );
	for ( let i = 0; i < bufferAttribute.count; i ++ ) {

		newBuffer.setXYZ(
			i,
			bufferAttribute.getX( i ),
			bufferAttribute.getY( i ),
			bufferAttribute.getZ( i ),
		);

	}

	return newBuffer;

}

function randomizeObjectTransform( target, uniformScale = false ) {

	target.rotation.x = random() * 10;
	target.rotation.y = random() * 10;
	target.rotation.z = random() * 10;

	target.position.x = random();
	target.position.y = random();
	target.position.z = random();

	if ( uniformScale ) {

		// TODO: temp fix related to issue gkjohnson/three-mesh-bvh#794
		target.scale.setScalar( random() * 2 - 1 );

	} else {

		target.scale.x = random() * 2 - 1;
		target.scale.y = random() * 2 - 1;
		target.scale.z = random() * 2 - 1;

	}

	target.updateMatrixWorld( true );

}
