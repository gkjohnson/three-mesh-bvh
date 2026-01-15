import {
	LineSegments,
	Line,
	LineLoop,
	BufferGeometry,
	Scene,
	Raycaster,
	Float32BufferAttribute,
	Uint16BufferAttribute,
	REVISION,
} from 'three';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	LineBVH,
	LineLoopBVH,
	LineSegmentsBVH,
	validateBounds,
} from 'three-mesh-bvh';
import { random, runTestMatrix, setSeed } from './utils.js';

Line.prototype.raycast = acceleratedRaycast;
LineLoop.prototype.raycast = acceleratedRaycast;
LineSegments.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

runTestMatrix( {
	indexed: [ true, false ],
	raycastThreshold: [ 0.01, 0.1 ],
	type: [ LineSegmentsBVH, LineLoopBVH, LineBVH ],
}, ( desc, options ) => {

	// The structure of the Line raycast results has changed in previous versions
	if ( REVISION >= 175 ) {

		describe( `Running with Options: { ${ desc } }`, () => runSuiteWithOptions( options ) );

	} else {

		describe.skip( 'Skipping tests due to three.js revision' );

	}

} );

function runSuiteWithOptions( options ) {

	const transformSeed = Math.floor( Math.random() * 1e10 );
	describe( `Transform Seed : ${ transformSeed }`, () => {

		let scene, raycaster, object, geometry, bvh;

		beforeAll( () => {

			// Create line segments geometry
			const segmentCount = 5;
			const vertexCount = segmentCount * 2;
			const positions = new Float32Array( vertexCount * 3 );
			const indices = options.indexed ? new Uint16Array( vertexCount ) : null;

			setSeed( transformSeed );

			// Generate random line segments in a sphere
			for ( let i = 0; i < segmentCount; i ++ ) {

				// Start point of line segment
				const theta1 = random() * Math.PI * 2;
				const phi1 = Math.acos( 2 * random() - 1 );
				const r1 = Math.cbrt( random() ) * 5;

				const v1Index = i * 2;
				positions[ v1Index * 3 + 0 ] = r1 * Math.sin( phi1 ) * Math.cos( theta1 );
				positions[ v1Index * 3 + 1 ] = r1 * Math.sin( phi1 ) * Math.sin( theta1 );
				positions[ v1Index * 3 + 2 ] = r1 * Math.cos( phi1 );

				// End point of line segment (nearby point)
				const theta2 = theta1 + ( random() - 0.5 ) * 0.5;
				const phi2 = phi1 + ( random() - 0.5 ) * 0.5;
				const r2 = r1 + ( random() - 0.5 ) * 0.5;

				const v2Index = i * 2 + 1;
				positions[ v2Index * 3 + 0 ] = r2 * Math.sin( phi2 ) * Math.cos( theta2 );
				positions[ v2Index * 3 + 1 ] = r2 * Math.sin( phi2 ) * Math.sin( theta2 );
				positions[ v2Index * 3 + 2 ] = r2 * Math.cos( phi2 );

				if ( indices ) {

					indices[ v1Index ] = v1Index;
					indices[ v2Index ] = v2Index;

				}

			}

			geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );

			if ( indices ) {

				geometry.setIndex( new Uint16BufferAttribute( indices, 1 ) );

			}

			geometry.computeBoundsTree( options );

			bvh = geometry.boundsTree;

			if ( options.type === LineSegmentsBVH ) {

				object = new LineSegments( geometry );

			} else if ( options.type === LineBVH ) {

				object = new Line( geometry );

			} else if ( options.type === LineLoopBVH ) {

				object = new LineLoop( geometry );

			}

			scene = new Scene();
			scene.add( object );

			raycaster = new Raycaster();
			raycaster.params.Line.threshold = options.raycastThreshold;

			setSeed( transformSeed );
			random();

			randomizeObjectTransform( object );

		} );

		for ( let i = 0; i < 100; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				setSeed( raySeed );
				random();

				raycaster.ray.origin.randomDirection().multiplyScalar( 10 );
				raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

				geometry.boundsTree = bvh;
				raycaster.firstHitOnly = false;
				const bvhHits = raycaster.intersectObject( object );

				geometry.boundsTree = bvh;
				raycaster.firstHitOnly = true;
				const firstHit = raycaster.intersectObject( object );

				geometry.boundsTree = null;
				raycaster.firstHitOnly = false;
				const ogHits = raycaster.intersectObject( object );

				expect( validateBounds( bvh ) ).toBeTruthy();
				expect( ogHits ).toEqual( bvhHits );
				expect( ogHits[ 0 ] ).toEqual( firstHit[ 0 ] );

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

	// NOTE: negative scales are not used because Line raycasting seems to not handle it correctly
	if ( uniformScale ) {

		target.scale.setScalar( random() );

	} else {

		target.scale.x = random();
		target.scale.y = random();
		target.scale.z = random();

	}

	target.updateMatrixWorld( true );

}
