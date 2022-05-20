import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshBVH, ExtendedTriangle } from '..';
import { generateEdges, lineIntersectTrianglePoint } from './utils/edgeUtils.js';

const params = {

};

let renderer, camera, scene, model, clock, gui, helper, controls;
let bvh;

init();
render();

function init() {

	const bgColor = 0xeeeeee;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0xffca28, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

	model = new THREE.Mesh( new THREE.TorusKnotBufferGeometry() );
	scene.add( model );

	bvh = new MeshBVH( model.geometry );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	// camera = new THREE.OrthographicCamera( - 10, 10, 10, - 10 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	clock = new THREE.Clock();

	controls = new OrbitControls( camera, renderer.domElement );

	gui = new GUI();

	updateEdges();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function updateEdges() {

	const edges = generateEdges( model.geometry, new THREE.Vector3( 0, 1, 0 ), 90 );
	const finalEdges = [];
	const tempLine = new THREE.Line3();
	const tempRay = new THREE.Ray();
	const tempVec = new THREE.Vector3();
	const tempVec0 = new THREE.Vector3();
	const tempVec1 = new THREE.Vector3();
	const tempDir = new THREE.Vector3();
	let target = {
		line: new THREE.Line3(),
		point: new THREE.Vector3(),
		type: '',
	};

	// TODO: iterate over all edges and check visibility upwards using BVH
	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		const line = edges[ i ];
		line.start.y += 1e-5;
		line.end.y += 1e-5;

		const lowestLineY = Math.min( line.start.y, line.end.y );
		const highestLineY = Math.max( line.start.y, line.end.y );
		const overlaps = [];
		bvh.shapecast( {

			intersectsBounds: box => {

				return true;

				// check if the box bounds are above the lowest line point
				box.min.y = Math.min( lowestLineY, box.min.y );
				tempRay.origin.copy( line.start );
				line.delta( tempRay.direction );

				tempRay.intersectsBox( box, tempVec );
				return line.start.distanceToSquared( tempVec ) < line.distanceSq();

			},

			intersectsTriangle: tri => {

				// skip the triangle if it is completely below the line
				const highestTriangleY = Math.max( tri.a.y, tri.b.y, tri.c.y );
				if ( highestTriangleY < lowestLineY ) {

					return false;

				}

				tempLine.copy( line );
				if ( lineIntersectTrianglePoint( tempLine, tri, target ) && target.type === 'point' ) {

					// shorten the edge to check to the line the falls below the triangle
					if ( tempLine.start.y > target.point.y ) {

						tempLine.start.copy( target.point );

					} else {

						tempLine.end.copy( target.point );

					}

				}

				// flatten them to a common plane
				tempLine.start.y = 0;
				tempLine.end.y = 0;
				tri.a.y = 0;
				tri.b.y = 0;
				tri.c.y = 0;
				tri.needsUpdate = true;

				const triPoints = tri.points;
				for ( let i = 0; i < 3; i ++ ) {

					const ni = ( i + 1 ) % 3;

					const t0 = triPoints[ i ];
					const t1 = triPoints[ ni ];

					if (
						tempLine.start.distanceTo( t0 ) < 1e-10 && tempLine.end.distanceTo( t1 ) < 1e-10 ||
						tempLine.start.distanceTo( t1 ) < 1e-10 && tempLine.end.distanceTo( t0 ) < 1e-10
					) {

						return false;

					}


				}

				if ( lineIntersectTrianglePoint( tempLine, tri, target ) && target.type === 'line' ) {

					// TODO: we need to make sure the d0 and 1 are always small -> large
					// find the overlap by using directions and dot products
					tempLine.delta( tempDir );
					tempVec0.subVectors( target.line.start, tempLine.start );
					tempVec1.subVectors( target.line.end, tempLine.start );

					const d0 = tempVec0.length() / tempDir.length();
					const d1 = tempVec1.length() / tempDir.length();

					if ( ! ( Math.abs( d0 - d1 ) < 1e-10 ) ) {

						overlaps.push( [ d0, d1 ] );

					}

				}

				return false;

			},

		} );

		overlaps.sort( ( a, b ) => {

			return a[ 0 ] - b[ 0 ];

		} );

		for ( let i = 1; i < overlaps.length; i ++ ) {

			const overlap = overlaps[ i ];
			const lastOverlap = overlaps[ i - 1 ];

			if ( overlap[ 0 ] <= lastOverlap[ 1 ] ) {

				if ( lastOverlap[ 1 ] > overlap[ 1 ] ) {

					overlap[ 1 ] = lastOverlap[ 1 ];

				}

				overlaps.splice( i, 1 );
				i --;
				continue;

			}

		}

		const invOverlaps = [[ 0, 1 ]];
		for ( let i = 0, l = overlaps.length; i < l; i ++ ) {

			invOverlaps[ i ][ 1 ] = overlaps[ i ][ 0 ];
			invOverlaps.push( [ overlaps[ i ][ 1 ], 1 ] );

		}

		for ( let i = 0, l = invOverlaps.length; i < l; i ++ ) {

			const newLine = new THREE.Line3();
			newLine.start.lerpVectors( line.start, line.end, invOverlaps[ i ][ 0 ] );
			newLine.end.lerpVectors( line.start, line.end, invOverlaps[ i ][ 1 ] );
			finalEdges.push( newLine );

		}

	}

	const edgeArray = [];
	finalEdges.forEach( l => {

		edgeArray.push( l.start.x, - 2, l.start.z );
		edgeArray.push( l.end.x, - 2, l.end.z );

	} );

	const edgeGeom = new THREE.BufferGeometry();
	const edgeBuffer = new THREE.BufferAttribute( new Float32Array( edgeArray ), 3, true );
	edgeGeom.setAttribute( 'position', edgeBuffer );
	scene.add( new THREE.LineSegments( edgeGeom, new THREE.LineBasicMaterial( { color: 0 } ) ) );

}

function render() {

	requestAnimationFrame( render );

	if ( helper ) {

		helper.visible = params.displayHelper;

	}

	renderer.render( scene, camera );

}
