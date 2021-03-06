import Stats from 'stats.js/src/Stats';
import * as dat from 'dat.gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	CONTAINED,
	INTERSECTED,
	NOT_INTERSECTED,
	MeshBVHVisualizer,
} from '../src/index.js';
import "@babel/polyfill";

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let stats;
let scene, camera, renderer, controls;
let targetMesh, brush, bvhHelper;
let normalZ = new THREE.Vector3( 0, 0, 1 );
let mouse = new THREE.Vector2(), lastMouse = new THREE.Vector2();
let mouseState = false, lastMouseState = false;
let lastCastPose = new THREE.Vector3();
let matcap;

const params = {
	size: 0.1,
	clayBrush: true,
	intensity: 50,
	maxSteps: 15,
	invert: false,
	flatShading: false,
	depth: 10,
	displayHelper: false,
};

function reset() {

	if ( targetMesh ) {

		targetMesh.geometry.dispose();
		targetMesh.material.dispose();
		scene.remove( targetMesh );

	}

	if ( ! matcap ) {

		matcap = new THREE.TextureLoader().load( '../textures/skinHazardousarts2.jpg' );

	}

	let geometry = new THREE.IcosahedronBufferGeometry( 1, 100 );
	geometry.deleteAttribute( 'uv' );
	geometry = BufferGeometryUtils.mergeVertices( geometry );

	geometry.computeBoundsTree();
	geometry.attributes.position.setUsage( THREE.DynamicDrawUsage );
	geometry.attributes.normal.setUsage( THREE.DynamicDrawUsage );

	targetMesh = new THREE.Mesh(
		geometry,
		new THREE.MeshMatcapMaterial( {
			flatShading: params.flatShading,
			matcap
		} )
	);
	targetMesh.material.matcap.encoding = THREE.sRGBEncoding;
	scene.add( targetMesh );

	if ( bvhHelper ) {

		bvhHelper.mesh = targetMesh;
		bvhHelper.update();

	}

}

function init() {

	const bgColor = 0x263238 / 2;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.gammaOutput = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0x263238 / 2, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 0.4 ) );

	// geometry setup
	reset();

	// initialize bvh helper
	bvhHelper = new MeshBVHVisualizer( targetMesh, params.depth );
	bvhHelper.visible = params.displayHelper;
	scene.add( bvhHelper );

	// initialize brush shape
	const brushSegments = [ new THREE.Vector3(), new THREE.Vector3( 0, 0, 1 ) ];
	for ( let i = 0; i < 50; i ++ ) {

		const nexti = i + 1;
		const x1 = Math.sin( 2 * Math.PI * i / 50 );
		const y1 = Math.cos( 2 * Math.PI * i / 50 );

		const x2 = Math.sin( 2 * Math.PI * nexti / 50 );
		const y2 = Math.cos( 2 * Math.PI * nexti / 50 );

		brushSegments.push(
			new THREE.Vector3( x1, y1, 0 ),
			new THREE.Vector3( x2, y2, 0 )
		);

	}
	brush = new THREE.LineSegments();
	brush.geometry.setFromPoints( brushSegments );
	brush.material.color.set( 0xfb8c00 );
	scene.add( brush );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 3, 3, 3 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );
	controls.minDistance = 1.5;

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const gui = new dat.GUI();

	const sculptFolder = gui.addFolder( 'Sculpting' );
	sculptFolder.add( params, 'clayBrush' );
	sculptFolder.add( params, 'size' ).min( 0.025 ).max( 0.25 ).step( 0.005 );
	sculptFolder.add( params, 'intensity' ).min( 1 ).max( 100 ).step( 1 );
	sculptFolder.add( params, 'maxSteps' ).min( 1 ).max( 50 ).step( 1 );
	sculptFolder.add( params, 'invert' );
	sculptFolder.add( params, 'flatShading' ).onChange( value => {

		targetMesh.material.flatShading = value;
		targetMesh.material.needsUpdate = true;

	} );
	sculptFolder.open();

	const helperFolder = gui.addFolder( 'BVH Helper' );
	helperFolder.add( params, 'depth' ).min( 1 ).max( 20 ).step( 1 ).onChange( d => {

		bvhHelper.depth = parseFloat( d );
		bvhHelper.update();

	} );
	helperFolder.add( params, 'displayHelper' ).onChange( display => {

		bvhHelper.visible = display;

	} );
	helperFolder.open();

	gui.add( { reset }, 'reset' );
	gui.add( { rebuildBVH: () => {

		targetMesh.geometry.computeBoundsTree();
		bvhHelper.update();

	} }, 'rebuildBVH' );
	gui.open();

	controls.addEventListener( 'start', function () {

		this.active = true;

	} );

	controls.addEventListener( 'end', function () {

		this.active = false;

	} );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	window.addEventListener( 'mousemove', function ( e ) {

		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;

	} );

	window.addEventListener( 'mousedown', e => {

		mouseState = Boolean( e.buttons & 1 );

	} );

	window.addEventListener( 'mouseup', e => {

		mouseState = Boolean( e.buttons & 1 );

	} );

	window.addEventListener( 'contextmenu', function ( e ) {

		e.preventDefault();

	} );

	window.addEventListener( 'wheel', function ( e ) {

		let delta = e.deltaY;

		if ( e.deltaMode === 1 ) {

			delta *= 40;

		}

		if ( e.deltaMode === 2 ) {

			delta *= 40;

		}

		params.size += delta * 0.0005;
		params.size = Math.max( Math.min( params.size, 0.25 ), 0.025 );

		gui.updateDisplay();

	} );

}

function performStroke( point, brushOnly = false ) {

	const inverseMatrix = new THREE.Matrix4();
	inverseMatrix.copy( targetMesh.matrixWorld ).invert();

	const sphere = new THREE.Sphere();
	sphere.center.copy( point ).applyMatrix4( inverseMatrix );
	sphere.radius = params.size;

	const indices = [];
	const tempVec = new THREE.Vector3();
	const tempVec2 = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const bvh = targetMesh.geometry.boundsTree;
	bvh.shapecast(
		targetMesh,
		box => {

			const intersects = sphere.intersectsBox( box );
			const { min, max } = box;
			if ( intersects ) {

				for ( let x = 0; x <= 1; x ++ ) {

					for ( let y = 0; y <= 1; y ++ ) {

						for ( let z = 0; z <= 1; z ++ ) {

							tempVec.set(
								x === 0 ? min.x : max.x,
								y === 0 ? min.y : max.y,
								z === 0 ? min.z : max.z
							);
							if ( ! sphere.containsPoint( tempVec ) ) {

								return INTERSECTED;

							}

						}

					}

				}

				return CONTAINED;

			}

			return intersects ? INTERSECTED : NOT_INTERSECTED;

		},
		( tri, a, b, c, contained ) => {

			if ( contained || tri.intersectsSphere( sphere ) ) {

				indices.push( a, b, c );

			}

			return false;

		}
	);
	const indexAttr = targetMesh.geometry.index;
	const posAttr = targetMesh.geometry.attributes.position;
	const normalAttr = targetMesh.geometry.attributes.normal;
	const indexSet = new Set( indices );
	tempVec2.copy( point ).applyMatrix4( inverseMatrix );
	indexSet.forEach( i => {

		const index = indexAttr.getX( i );
		tempVec.fromBufferAttribute( posAttr, index );

		const dist = tempVec.distanceTo( tempVec2 );
		if ( dist > params.size ) {

			return;

		}

		tempVec.fromBufferAttribute( normalAttr, index );
		normal.add( tempVec );

	} );
	normal.normalize();
	brush.quaternion.setFromUnitVectors( normalZ, normal );

	if ( brushOnly ) {

		return;

	}

	// perform vertex adjustment

	const indexToTriangles = {};
	indexSet.forEach( i => {

		const index = indexAttr.getX( i );
		tempVec.fromBufferAttribute( posAttr, index );

		const dist = tempVec.distanceTo( tempVec2 );
		if ( dist > params.size ) {

			return;

		}

		let intensity = 1.0 - ( dist / params.size );
		intensity *= intensity;
		if ( params.clayBrush ) {

			intensity = Math.min( intensity, 0.1 );

		} else {

			intensity *= 0.5;

		}

		if ( params.invert ) {

			intensity *= - 1;

		}

		tempVec.addScaledVector( normal, intensity * params.intensity * 0.00005 );
		posAttr.setXYZ( index, tempVec.x, tempVec.y, tempVec.z );

		let arr = indexToTriangles[ index ];
		if ( ! arr ) {

			arr = indexToTriangles[ index ] = [];

		}

		arr.push( ~ ~ ( i / 3 ) );

	} );

	if ( indices.length ) {

		// TODO: this can be improved
		const triangle = new THREE.Triangle();
		for ( const index in indexToTriangles ) {

			tempVec.set( 0, 0, 0 );

			const arr = indexToTriangles[ index ];
			for ( const tri in arr ) {

				const i3 = arr[ tri ] * 3;
				triangle.a.fromBufferAttribute( posAttr, indexAttr.getX( i3 + 0 ) );
				triangle.b.fromBufferAttribute( posAttr, indexAttr.getX( i3 + 1 ) );
				triangle.c.fromBufferAttribute( posAttr, indexAttr.getX( i3 + 2 ) );

				triangle.getNormal( tempVec2 );
				tempVec.add( tempVec2 );

			}

			tempVec.normalize();
			normalAttr.setXYZ( index, tempVec.x, tempVec.y, tempVec.z );

		}

		posAttr.needsUpdate = true;
		normalAttr.needsUpdate = true;

	}

}

function render() {

	requestAnimationFrame( render );

	stats.begin();

	if ( controls.active ) {

		brush.visible = false;
		lastCastPose.setScalar( Infinity );

	} else {

		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera( mouse, camera );
		raycaster.firstHitOnly = true;

		const hit = raycaster.intersectObject( targetMesh, true )[ 0 ];
		if ( hit ) {

			brush.visible = true;
			brush.scale.set( params.size, params.size, 0.1 );
			brush.position.copy( hit.point );
			brush.quaternion.setFromUnitVectors( normalZ, hit.face.normal );
			controls.enabled = false;

			if ( lastCastPose.x === Infinity ) {

				lastCastPose.copy( hit.point );

			}

			const mdx = ( mouse.x - lastMouse.x ) * window.innerWidth * window.devicePixelRatio;
			const mdy = ( mouse.y - lastMouse.y ) * window.innerHeight * window.devicePixelRatio;
			let mdist = Math.sqrt( mdx * mdx + mdy * mdy );
			let castDist = hit.point.distanceTo( lastCastPose );

			if ( ! ( mouseState || lastMouseState ) ) {

				performStroke( hit.point, true );
				lastMouse.copy( mouse );
				lastCastPose.copy( hit.point );

			} else {

				const step = params.size * 0.15;
				const percent = Math.max( step / castDist, 1 / params.maxSteps );
				const mstep = mdist * percent;
				let stepCount = 0;

				while ( castDist > step && mdist > params.size * 200 / hit.distance ) {

					lastMouse.lerp( mouse, percent );
					lastCastPose.lerp( hit.point, percent );
					castDist -= step;
					mdist -= mstep;

					performStroke( lastCastPose, false );
					stepCount ++;
					if ( stepCount > params.maxSteps ) {

						break;

					}

				}

				if ( stepCount > 0 ) {

					targetMesh.geometry.boundsTree.refit( targetMesh.geometry );
					bvhHelper.update();

				}

			}

		} else {

			controls.enabled = true;
			brush.visible = false;
			lastMouse.copy( mouse );
			lastCastPose.setScalar( Infinity );

		}

	}

	lastMouseState = mouseState;

	renderer.render( scene, camera );
	stats.end();

}


init();
render();
