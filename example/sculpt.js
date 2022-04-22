import Stats from 'stats.js/src/Stats';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	CONTAINED,
	INTERSECTED,
	NOT_INTERSECTED,
	MeshBVHVisualizer,
} from '..';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let stats;
let scene, camera, renderer, controls;
let targetMesh, brush, symmetryBrush, bvhHelper;
let normalZ = new THREE.Vector3( 0, 0, 1 );
let brushActive = false;
let mouse = new THREE.Vector2(), lastMouse = new THREE.Vector2();
let mouseState = false, lastMouseState = false;
let lastCastPose = new THREE.Vector3();
let material, rightClick = false;

const params = {
	matcap: 'Clay',

	size: 0.1,
	brush: 'clay',
	intensity: 50,
	maxSteps: 10,
	invert: false,
	symmetrical: true,
	flatShading: false,

	depth: 10,
	displayHelper: false,
};

const matcaps = {};

init();
render();

// reset the sculpt mesh
function reset() {

	// dispose of the mesh if it exists
	if ( targetMesh ) {

		targetMesh.geometry.dispose();
		targetMesh.material.dispose();
		scene.remove( targetMesh );

	}

	// merge the vertices because they're not already merged
	let geometry = new THREE.IcosahedronBufferGeometry( 1, 100 );
	geometry.deleteAttribute( 'uv' );
	geometry = BufferGeometryUtils.mergeVertices( geometry );
	geometry.attributes.position.setUsage( THREE.DynamicDrawUsage );
	geometry.attributes.normal.setUsage( THREE.DynamicDrawUsage );
	geometry.computeBoundsTree( { setBoundingBox: false } );

	// disable frustum culling because the verts will be updated
	targetMesh = new THREE.Mesh(
		geometry,
		material,
	);
	targetMesh.frustumCulled = false;
	scene.add( targetMesh );

	// initialize bvh helper
	if ( ! bvhHelper ) {

		bvhHelper = new MeshBVHVisualizer( targetMesh, params.depth );
		if ( params.displayHelper ) {

			scene.add( bvhHelper );

		}

	}

	bvhHelper.mesh = targetMesh;
	bvhHelper.update();

}

function init() {

	const bgColor = 0x060609;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );
	renderer.domElement.style.touchAction = 'none';

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0x263238 / 2, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 0.4 ) );

	// initialize brush cursor
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

	symmetryBrush = brush.clone();
	scene.add( symmetryBrush );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 0, 3 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// init matcaps
	matcaps[ 'Clay' ] = new THREE.TextureLoader().load( '../textures/B67F6B_4B2E2A_6C3A34_F3DBC6-256px.png' );
	matcaps[ 'Red Wax' ] = new THREE.TextureLoader().load( '../textures/763C39_431510_210504_55241C-256px.png' );
	matcaps[ 'Shiny Green' ] = new THREE.TextureLoader().load( '../textures/3B6E10_E3F2C3_88AC2E_99CE51-256px.png' );
	matcaps[ 'Normal' ] = new THREE.TextureLoader().load( '../textures/7877EE_D87FC5_75D9C7_1C78C0-256px.png' );
	material = new THREE.MeshMatcapMaterial( {
		flatShading: params.flatShading,
	} );

	for ( const key in matcaps ) {

		matcaps[ key ].encoding = THREE.sRGBEncoding;

	}

	// geometry setup
	reset();

	const gui = new dat.GUI();
	gui.add( params, 'matcap', Object.keys( matcaps ) );

	const sculptFolder = gui.addFolder( 'Sculpting' );
	sculptFolder.add( params, 'brush', [ 'normal', 'clay', 'flatten' ] );
	sculptFolder.add( params, 'size' ).min( 0.025 ).max( 0.25 ).step( 0.005 );
	sculptFolder.add( params, 'intensity' ).min( 1 ).max( 100 ).step( 1 );
	sculptFolder.add( params, 'maxSteps' ).min( 1 ).max( 25 ).step( 1 );
	sculptFolder.add( params, 'symmetrical' );
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

		if ( display ) {

			scene.add( bvhHelper );
			bvhHelper.update();

		} else {

			scene.remove( bvhHelper );

		}

	} );
	helperFolder.open();

	gui.add( { reset }, 'reset' );
	gui.add( { rebuildBVH: () => {

		// don't create a bounding box because it's used in BVH construction but
		// will be out of date after moving vertices. See issue #222.
		targetMesh.geometry.computeBoundsTree( { setBoundingBox: false } );
		bvhHelper.update();

	} }, 'rebuildBVH' );
	gui.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	window.addEventListener( 'pointermove', function ( e ) {

		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
		brushActive = true;

	} );

	window.addEventListener( 'pointerdown', e => {

		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
		mouseState = Boolean( e.buttons & 3 );
		rightClick = Boolean( e.buttons & 2 );
		brushActive = true;

		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera( mouse, camera );
		raycaster.firstHitOnly = true;

		const res = raycaster.intersectObject( targetMesh );
		controls.enabled = res.length === 0;

	}, true );

	window.addEventListener( 'pointerup', e => {

		mouseState = Boolean( e.buttons & 3 );
		if ( e.pointerType === 'touch' ) {

			brushActive = false;

		}

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

		params.size += delta * 0.0001;
		params.size = Math.max( Math.min( params.size, 0.25 ), 0.025 );
		gui.controllersRecursive().forEach( c => c.updateDisplay() );

	} );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.minDistance = 1.5;

	controls.addEventListener( 'start', function () {

		this.active = true;

	} );

	controls.addEventListener( 'end', function () {

		this.active = false;

	} );

}

// Run the perform the brush movement
function performStroke( point, brushObject, brushOnly = false, accumulatedFields = {} ) {

	const {
		accumulatedTriangles = new Set(),
		accumulatedIndices = new Set(),
		accumulatedTraversedNodeIndices = new Set(),
	} = accumulatedFields;

	const inverseMatrix = new THREE.Matrix4();
	inverseMatrix.copy( targetMesh.matrixWorld ).invert();

	const sphere = new THREE.Sphere();
	sphere.center.copy( point ).applyMatrix4( inverseMatrix );
	sphere.radius = params.size;

	// Collect the intersected vertices
	const indices = new Set();
	const tempVec = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const indexAttr = targetMesh.geometry.index;
	const posAttr = targetMesh.geometry.attributes.position;
	const normalAttr = targetMesh.geometry.attributes.normal;
	const triangles = new Set();
	const bvh = targetMesh.geometry.boundsTree;
	bvh.shapecast( {

		intersectsBounds: ( box, isLeaf, score, depth, nodeIndex ) => {

			accumulatedTraversedNodeIndices.add( nodeIndex );

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

		intersectsTriangle: ( tri, index, contained ) => {

			const triIndex = index;
			triangles.add( triIndex );
			accumulatedTriangles.add( triIndex );

			const i3 = 3 * index;
			const a = i3 + 0;
			const b = i3 + 1;
			const c = i3 + 2;
			const va = indexAttr.getX( a );
			const vb = indexAttr.getX( b );
			const vc = indexAttr.getX( c );
			if ( contained ) {

				indices.add( va );
				indices.add( vb );
				indices.add( vc );

				accumulatedIndices.add( va );
				accumulatedIndices.add( vb );
				accumulatedIndices.add( vc );

			} else {

				if ( sphere.containsPoint( tri.a ) ) {

					indices.add( va );
					accumulatedIndices.add( va );

				}

				if ( sphere.containsPoint( tri.b ) ) {

					indices.add( vb );
					accumulatedIndices.add( vb );

				}

				if ( sphere.containsPoint( tri.c ) ) {

					indices.add( vc );
					accumulatedIndices.add( vc );

				}

			}

			return false;

		}

	} );

	// Compute the average normal at this point
	const localPoint = new THREE.Vector3();
	localPoint.copy( point ).applyMatrix4( inverseMatrix );

	const planePoint = new THREE.Vector3();
	let totalPoints = 0;
	indices.forEach( index => {

		tempVec.fromBufferAttribute( normalAttr, index );
		normal.add( tempVec );

		// compute the average point for cases where we need to flatten
		// to the plane.
		if ( ! brushOnly ) {

			totalPoints ++;
			tempVec.fromBufferAttribute( posAttr, index );
			planePoint.add( tempVec );

		}

	} );
	normal.normalize();
	brushObject.quaternion.setFromUnitVectors( normalZ, normal );

	if ( totalPoints ) {

		planePoint.multiplyScalar( 1 / totalPoints );

	}

	// Early out if we just want to adjust the brush
	if ( brushOnly ) {

		return;

	}

	// perform vertex adjustment
	const targetHeight = params.intensity * 0.0001;
	const plane = new THREE.Plane();
	plane.setFromNormalAndCoplanarPoint( normal, planePoint );

	indices.forEach( index => {

		tempVec.fromBufferAttribute( posAttr, index );

		// compute the offset intensity
		const dist = tempVec.distanceTo( localPoint );
		const negated = params.invert !== rightClick ? - 1 : 1;
		let intensity = 1.0 - ( dist / params.size );

		// offset the vertex
		if ( params.brush === 'clay' ) {

			intensity = Math.pow( intensity, 3 );
			const planeDist = plane.distanceToPoint( tempVec );
			const clampedIntensity = negated * Math.min( intensity * 4, 1.0 );
			tempVec.addScaledVector( normal, clampedIntensity * targetHeight - negated * planeDist * clampedIntensity * 0.3 );

		} else if ( params.brush === 'normal' ) {

			intensity = Math.pow( intensity, 2 );
			tempVec.addScaledVector( normal, negated * intensity * targetHeight );

		} else if ( params.brush === 'flatten' ) {

			intensity = Math.pow( intensity, 2 );

			const planeDist = plane.distanceToPoint( tempVec );
			tempVec.addScaledVector( normal, - planeDist * intensity * params.intensity * 0.01 * 0.5 );

		}

		posAttr.setXYZ( index, tempVec.x, tempVec.y, tempVec.z );
		normalAttr.setXYZ( index, 0, 0, 0 );

	} );

	// If we found vertices
	if ( indices.size ) {

		posAttr.needsUpdate = true;

	}

}

function updateNormals( triangles, indices ) {

	const tempVec = new THREE.Vector3();
	const tempVec2 = new THREE.Vector3();
	const indexAttr = targetMesh.geometry.index;
	const posAttr = targetMesh.geometry.attributes.position;
	const normalAttr = targetMesh.geometry.attributes.normal;

	// accumulate the normals in place in the normal buffer
	const triangle = new THREE.Triangle();
	triangles.forEach( tri => {

		const tri3 = tri * 3;
		const i0 = tri3 + 0;
		const i1 = tri3 + 1;
		const i2 = tri3 + 2;

		const v0 = indexAttr.getX( i0 );
		const v1 = indexAttr.getX( i1 );
		const v2 = indexAttr.getX( i2 );

		triangle.a.fromBufferAttribute( posAttr, v0 );
		triangle.b.fromBufferAttribute( posAttr, v1 );
		triangle.c.fromBufferAttribute( posAttr, v2 );
		triangle.getNormal( tempVec2 );

		if ( indices.has( v0 ) ) {

			tempVec.fromBufferAttribute( normalAttr, v0 );
			tempVec.add( tempVec2 );
			normalAttr.setXYZ( v0, tempVec.x, tempVec.y, tempVec.z );

		}

		if ( indices.has( v1 ) ) {

			tempVec.fromBufferAttribute( normalAttr, v1 );
			tempVec.add( tempVec2 );
			normalAttr.setXYZ( v1, tempVec.x, tempVec.y, tempVec.z );

		}

		if ( indices.has( v2 ) ) {

			tempVec.fromBufferAttribute( normalAttr, v2 );
			tempVec.add( tempVec2 );
			normalAttr.setXYZ( v2, tempVec.x, tempVec.y, tempVec.z );

		}

	} );

	// normalize the accumulated normals
	indices.forEach( index => {

		tempVec.fromBufferAttribute( normalAttr, index );
		tempVec.normalize();
		normalAttr.setXYZ( index, tempVec.x, tempVec.y, tempVec.z );

	} );

	normalAttr.needsUpdate = true;

}

function render() {

	requestAnimationFrame( render );

	stats.begin();

	material.matcap = matcaps[ params.matcap ];

	if ( controls.active || ! brushActive ) {

		// If the controls are being used then don't perform the strokes
		brush.visible = false;
		symmetryBrush.visible = false;
		lastCastPose.setScalar( Infinity );

	} else {

		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera( mouse, camera );
		raycaster.firstHitOnly = true;

		const hit = raycaster.intersectObject( targetMesh, true )[ 0 ];
		// if we hit the target mesh
		if ( hit ) {

			brush.visible = true;
			brush.scale.set( params.size, params.size, 0.1 );
			brush.position.copy( hit.point );

			symmetryBrush.visible = params.symmetrical;
			symmetryBrush.scale.set( params.size, params.size, 0.1 );
			symmetryBrush.position.copy( hit.point );
			symmetryBrush.position.x *= - 1;

			controls.enabled = false;

			// if the last cast pose was missed in the last frame then set it to
			// the current point so we don't streak across the surface
			if ( lastCastPose.x === Infinity ) {

				lastCastPose.copy( hit.point );

			}

			// If the mouse isn't pressed don't perform the stroke
			if ( ! ( mouseState || lastMouseState ) ) {

				performStroke( hit.point, brush, true );
				if ( params.symmetrical ) {

					hit.point.x *= - 1;
					performStroke( hit.point, symmetryBrush, true );
					hit.point.x *= - 1;

				}

				lastMouse.copy( mouse );
				lastCastPose.copy( hit.point );

			} else {

				// compute the distance the mouse moved and that the cast point moved
				const mdx = ( mouse.x - lastMouse.x ) * window.innerWidth * window.devicePixelRatio;
				const mdy = ( mouse.y - lastMouse.y ) * window.innerHeight * window.devicePixelRatio;
				let mdist = Math.sqrt( mdx * mdx + mdy * mdy );
				let castDist = hit.point.distanceTo( lastCastPose );

				const step = params.size * 0.15;
				const percent = Math.max( step / castDist, 1 / params.maxSteps );
				const mstep = mdist * percent;
				let stepCount = 0;

				// perform multiple iterations toward the current mouse pose for a consistent stroke
				// TODO: recast here so he cursor is on the surface of the model which requires faster
				// refitting of the model
				const changedTriangles = new Set();
				const changedIndices = new Set();
				const traversedNodeIndices = new Set();
				const sets = {

					accumulatedTriangles: changedTriangles,
					accumulatedIndices: changedIndices,
					accumulatedTraversedNodeIndices: traversedNodeIndices,

				};
				while ( castDist > step && mdist > params.size * 200 / hit.distance ) {

					lastMouse.lerp( mouse, percent );
					lastCastPose.lerp( hit.point, percent );
					castDist -= step;
					mdist -= mstep;

					performStroke( lastCastPose, brush, false, sets );

					if ( params.symmetrical ) {

						lastCastPose.x *= - 1;
						performStroke( lastCastPose, symmetryBrush, false, sets );
						lastCastPose.x *= - 1;

					}

					stepCount ++;
					if ( stepCount > params.maxSteps ) {

						break;

					}

				}

				// refit the bounds and update the normals if we adjusted the mesh
				if ( stepCount > 0 ) {

					// refit bounds and normal updates could happen after every stroke
					// so it's up to date for the next one because both of those are used when updating
					// the model but it's faster to do them here.
					updateNormals( changedTriangles, changedIndices );
					targetMesh.geometry.boundsTree.refit( traversedNodeIndices );

					if ( bvhHelper.parent !== null ) {

						bvhHelper.update();

					}

				} else {

					performStroke( hit.point, brush, true );
					if ( params.symmetrical ) {

						hit.point.x *= - 1;
						performStroke( hit.point, symmetryBrush, true );
						hit.point.x *= - 1;

					}

				}

			}

		} else {

			// if we didn't hit
			controls.enabled = true;
			brush.visible = false;
			symmetryBrush.visible = false;
			lastMouse.copy( mouse );
			lastCastPose.setScalar( Infinity );

		}

	}

	lastMouseState = mouseState;

	renderer.render( scene, camera );
	stats.end();

}
