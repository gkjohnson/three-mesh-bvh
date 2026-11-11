import {
	Points,
	BufferGeometry,
	Scene,
	Raycaster,
	PointsMaterial,
	Float32BufferAttribute,
	Uint16BufferAttribute,
	Group,
	Vector3,
	REVISION,
} from 'three';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	PointsBVH,
	validateBounds,
} from 'three-mesh-bvh';
import { random, randomizeObjectTransform, runTestMatrix, setSeed } from './utils.js';

Points.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

runTestMatrix( {
	indexed: [ true, false ],
	raycastThreshold: [ 0.01, 0.1 ],
}, ( desc, options ) => {

	// The structure of the Line raycast results has changed in previous versions
	if ( REVISION >= 175 ) {

		describe( `Running with Options: { ${ desc } }`, () => runSuiteWithOptions( options ) );

	} else {

		describe.skip( 'Skipping tests due to three.js revision' );

	}

} );

// The structure of the raycast results has changed in previous versions
describe.skipIf( parseInt( REVISION ) < 175 )( 'Raycast threshold scale', () => {

	// the bvh must scale the threshold the same way Points.raycast does in the installed three.js version
	const cases = [
		{ name: 'non-uniform object scale', objectScale: [ 1, 1, 0.5 ], parentScale: 1, offset: 0.11 },
		{ name: 'scaled parent', objectScale: [ 1, 1, 1 ], parentScale: 2, offset: 0.15 },
	];

	for ( const { name, objectScale, parentScale, offset } of cases ) {

		it( `matches three.js with a ${ name }`, () => {

			// the second point keeps the bounding sphere large enough that three's sphere check passes
			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0, 1, 0, 0 ], 3 ) );
			geometry.computeBoundsTree( { type: PointsBVH } );
			const bvh = geometry.boundsTree;

			const pointCloud = new Points( geometry );
			pointCloud.scale.set( ...objectScale );

			const parent = new Group();
			parent.scale.setScalar( parentScale );
			parent.add( pointCloud );
			parent.updateMatrixWorld( true );

			const raycaster = new Raycaster( new Vector3( offset, - 1, 0 ), new Vector3( 0, 1, 0 ) );
			raycaster.params.Points.threshold = 0.1;

			const bvhHits = raycaster.intersectObject( pointCloud );

			geometry.boundsTree = null;
			const ogHits = raycaster.intersectObject( pointCloud );
			geometry.boundsTree = bvh;

			expect( bvhHits ).toEqual( ogHits );

		} );

	}

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
				const r = Math.cbrt( random() ) * 5;

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

			geometry.computeBoundsTree( { ...options, type: PointsBVH } );

			bvh = geometry.boundsTree;

			pointCloud = new Points( geometry, new PointsMaterial( { size: 0.1 } ) );

			scene = new Scene();
			scene.add( pointCloud );

			raycaster = new Raycaster();
			raycaster.params.Points.threshold = options.raycastThreshold;

			setSeed( transformSeed );
			random();

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

				expect( validateBounds( bvh ) ).toBeTruthy();
				expect( ogHits ).toEqual( bvhHits );
				expect( ogHits[ 0 ] ).toEqual( firstHit[ 0 ] );

			} );

		}

	} );

}

