import {
	Points,
	BufferGeometry,
	Scene,
	Raycaster,
	PointsMaterial,
	Float32BufferAttribute,
	Uint16BufferAttribute,
} from 'three';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	PointsBVH,
} from 'three-mesh-bvh';
import { random, runTestMatrix, setSeed } from './utils.js';

Points.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

runTestMatrix( {
	indexed: [ true, false ],
	raycastThreshold: [ 0.01, 0.1 ],
}, ( desc, options ) => {

	describe( `Running with Options: { ${ desc } }`, () => runSuiteWithOptions( options ) );

} );

function runSuiteWithOptions( options ) {

	const transformSeed = Math.floor( Math.random() * 1e10 );
	describe( `Transform Seed : ${ transformSeed }`, () => {

		let scene, raycaster, pointCloud, geometry, bvh;

		beforeAll( () => {

			// Create a point cloud geometry
			const pointCount = 500;
			const positions = new Float32Array( pointCount * 3 );
			const indices = options.indexed ? new Uint16Array( pointCount ) : null;

			setSeed( transformSeed );

			// Generate random points in a sphere
			for ( let i = 0; i < pointCount; i ++ ) {

				const theta = random() * Math.PI * 2;
				const phi = Math.acos( 2 * random() - 1 );
				const r = Math.cbrt( random() ) * 5; // cube root for uniform distribution

				positions[ i * 3 + 0 ] = r * Math.sin( phi ) * Math.cos( theta );
				positions[ i * 3 + 1 ] = r * Math.sin( phi ) * Math.sin( theta );
				positions[ i * 3 + 2 ] = r * Math.cos( phi );

				if ( indices ) {

					indices[ i ] = i;

				}

			}

			geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );

			if ( indices ) {

				geometry.setIndex( new Uint16BufferAttribute( indices, 1 ) );

			}

			geometry.computeBoundsTree( { type: PointsBVH } );

			bvh = geometry.boundsTree;

			pointCloud = new Points( geometry, new PointsMaterial( { size: 0.1 } ) );

			scene = new Scene();
			scene.add( pointCloud );

			raycaster = new Raycaster();
			raycaster.params.Points.threshold = options.raycastThreshold;

			setSeed( transformSeed );
			random(); // call random() to seed with a larger value

			randomizeObjectTransform( pointCloud );

		} );

		// note we only check distances since it's commonly the case that
		for ( let i = 0; i < 100; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				setSeed( raySeed );
				random();

				raycaster.ray.origin.randomDirection().multiplyScalar( 10 );
				raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

				geometry.boundsTree = bvh;
				raycaster.firstHitOnly = false;
				const bvhHits = raycaster.intersectObject( pointCloud );

				geometry.boundsTree = bvh;
				raycaster.firstHitOnly = true;
				const firstHit = raycaster.intersectObject( pointCloud );

				geometry.boundsTree = null;
				raycaster.firstHitOnly = false;
				const ogHits = raycaster.intersectObject( pointCloud );

				expect( ogHits ).toEqual( bvhHits );
				expect( firstHit[ 0 ] ).toEqual( ogHits[ 0 ] );

			} );

		}

	} );

}

function randomizeObjectTransform( target, uniformScale = false ) {

	target.rotation.x = random() * 10;
	target.rotation.y = random() * 10;
	target.rotation.z = random() * 10;

	target.position.x = random();
	target.position.y = random();
	target.position.z = random();

	if ( uniformScale ) {

		target.scale.setScalar( random() * 2 - 1 );

	} else {

		target.scale.x = random() * 2 - 1;
		target.scale.y = random() * 2 - 1;
		target.scale.z = random() * 2 - 1;

	}

	target.updateMatrixWorld( true );

}
