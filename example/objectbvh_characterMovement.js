import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { MeshBVH, ObjectBVH, BVHHelper, ExtendedTriangle } from 'three-mesh-bvh';

const params = {
	firstPerson: false,
	displayBVH: false,
	visualizeDepth: 10,
	gravity: - 80,
	playerSpeed: 10,
	physicsSteps: 5,
	reset: () => reset(),
};

const OFF_GROUND_TIME = 0.05;
const WALK_CYCLE_TIME = 2 * Math.PI;

// Module-level reusable vectors/matrices for physics calculations
const _playerVelocity = new THREE.Vector3();
const _upVector = new THREE.Vector3( 0, 1, 0 );
const _tempVector = new THREE.Vector3();
const _tempVector2 = new THREE.Vector3();
const _walkDirection = new THREE.Vector3();
const _segmentStart = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _sceneLocalBox = new THREE.Box3();
const _objectLocalBox = new THREE.Box3();
const _invMat = new THREE.Matrix4();
const _worldSegment = new THREE.Line3();
const _worldTriangle = new ExtendedTriangle();

let renderer, camera, scene, clock, stats, controls;
let level, player, playerMesh, sceneBVH, sceneHelper;
let playerIsOnGround = false;
let offGroundTimer = OFF_GROUND_TIME;
let walkAnimation = 0;

const keys = { fwd: false, bkd: false, lft: false, rgt: false };

init();
renderer.setAnimationLoop( render );

function init() {

	const bgColor = 0x131619;

	// Renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 200 );
	camera.position.set( 15, 7.5, 15 );

	// Lights
	const light = new THREE.DirectionalLight( 0xffffff, 3 );
	light.position.set( 50, 75, 50 );
	light.shadow.mapSize.setScalar( 2048 );
	light.shadow.bias = - 1e-4;
	light.shadow.normalBias = 0.05;
	light.shadow.radius = 3;
	light.castShadow = true;

	const shadowCam = light.shadow.camera;
	shadowCam.left = shadowCam.bottom = - 30;
	shadowCam.top = 30;
	shadowCam.right = 45;

	scene.add( light, new THREE.HemisphereLight( 0xffffff, 0x223344, 0.4 ) );

	// Controls
	controls = new OrbitControls( camera, renderer.domElement );
	clock = new THREE.Clock();

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// Load environment
	loadColliderEnvironment();

	// Create player
	player = new THREE.Group();
	player.rotation.y = Math.PI / 2;
	player.capsuleInfo = {
		radius: 0.75,
		segment: new THREE.Line3( new THREE.Vector3( 0, 0.75, 0 ), new THREE.Vector3( 0, 1.0, 0 ) )
	};

	// Player mesh parts
	playerMesh = new THREE.Group();
	player.add( playerMesh );

	const material = new THREE.MeshStandardMaterial( { shadowSide: 2 } );

	const body = new THREE.Mesh( new RoundedBoxGeometry( 1.0, 2.0, 1.0, 10, 0.5 ), material );
	body.position.y = 0.75;
	body.castShadow = body.receiveShadow = true;

	const arms = new THREE.Mesh( new RoundedBoxGeometry( 0.5, 2.0, 0.5, 10, 0.5 ), material );
	arms.rotation.x = Math.PI / 2;
	arms.position.y = 1.25;
	arms.castShadow = arms.receiveShadow = true;

	const head = new THREE.Mesh( new THREE.SphereGeometry( 0.5 ), material );
	head.position.y = 2;
	head.castShadow = head.receiveShadow = true;

	playerMesh.add( body, arms, head );
	scene.add( player );
	reset();

	// GUI
	const gui = new GUI();
	gui.add( params, 'firstPerson' ).onChange( v => {

		if ( ! v ) {

			camera.position
				.sub( controls.target )
				.normalize()
				.multiplyScalar( 10 )
				.add( controls.target );

		}

	} );

	const visFolder = gui.addFolder( 'Visualization' );
	visFolder.add( params, 'displayBVH' );
	visFolder.add( params, 'visualizeDepth', 1, 20, 1 ).onChange( () => {

		sceneHelper.depth = params.visualizeDepth;
		sceneHelper.update();

	} );

	const physicsFolder = gui.addFolder( 'Player' );
	physicsFolder.add( params, 'physicsSteps', 0, 30, 1 );
	physicsFolder.add( params, 'gravity', - 100, 100, 0.01 );
	physicsFolder.add( params, 'playerSpeed', 1, 20 );

	gui.add( params, 'reset' );

	// Event listeners
	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

	window.addEventListener( 'keydown', e => {

		switch ( e.code ) {

			case 'KeyW': keys.fwd = true; break;
			case 'KeyS': keys.bkd = true; break;
			case 'KeyD': keys.rgt = true; break;
			case 'KeyA': keys.lft = true; break;
			case 'Space':
				if ( playerIsOnGround || offGroundTimer > 0 ) {

					_playerVelocity.y = 20.0;
					playerIsOnGround = false;
					offGroundTimer = 0;

				}

				break;

		}

	} );

	window.addEventListener( 'keyup', e => {

		switch ( e.code ) {

			case 'KeyW': keys.fwd = false; break;
			case 'KeyS': keys.bkd = false; break;
			case 'KeyD': keys.rgt = false; break;
			case 'KeyA': keys.lft = false; break;

		}

	} );

}

function loadColliderEnvironment() {

	new GLTFLoader().load( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/grandmas-house/grandmas_house.glb', res => {

		const gltfScene = res.scene;
		gltfScene.scale.setScalar( 1.75 );
		gltfScene.updateMatrixWorld( true );

		// Setup materials and geometry
		const toRemove = [];
		gltfScene.traverse( c => {

			if ( c.material?.isMeshPhysicalMaterial ) {

				c.material.transmission = 0;

			}

			// Remove cat/sheep models
			if ( /cat|sheep/.test( c.name ) ) {

				c.traverse( child => {

					if ( child.material ) {

						child.material = child.material.clone();
						child.material.color.set( 0xff0000 );

					}

				} );
				toRemove.push( c );
				return;

			}

			c.castShadow = c.receiveShadow = true;
			if ( c.isMesh && ! c.geometry.boundsTree ) {

				c.geometry.boundsTree = new MeshBVH( c.geometry );

			}

		} );

		toRemove.forEach( c => c.removeFromParent() );

		level = gltfScene;
		scene.add( level );

		level.updateMatrixWorld( true );
		sceneBVH = new ObjectBVH( level, { targetLeafSize: 1 } );

		sceneHelper = new BVHHelper( level, sceneBVH );
		sceneHelper.opacity = 0.5;
		sceneHelper.color.set( 0xffffff );
		sceneHelper.update();
		scene.add( sceneHelper );

	} );

}

function reset() {

	_playerVelocity.set( 0, 0, 0 );
	player.position.set( 8, 10, 2.5 );
	camera.position.sub( controls.target );
	controls.target.copy( player.position );
	camera.position.add( player.position );
	controls.update();

}

// Get the bounds of the world space capsule transformed by the given matrix
function getCapsuleBox( matrix, target ) {

	const { radius } = player.capsuleInfo;
	target.makeEmpty();
	target.expandByPoint( _worldSegment.start );
	target.expandByPoint( _worldSegment.end );
	target.min.addScalar( - radius );
	target.max.addScalar( radius );
	return target.applyMatrix4( matrix );

}

function updatePlayer( delta ) {

	player.updateMatrixWorld();
	_invMat.copy( sceneBVH.matrixWorld ).invert();

	// Get capsule in world space
	const capsuleInfo = player.capsuleInfo;
	_worldSegment
		.copy( capsuleInfo.segment )
		.applyMatrix4( player.matrixWorld );

	// Apply gravity
	_playerVelocity.y += delta * params.gravity;
	_worldSegment.start.addScaledVector( _playerVelocity, delta );
	_worldSegment.end.addScaledVector( _playerVelocity, delta );

	// Calculate walk direction relative to the camera
	const walkDirection = _walkDirection
		.set( Number( keys.rgt ) - Number( keys.lft ), 0, Number( keys.bkd ) - Number( keys.fwd ) )
		.applyAxisAngle( _upVector, controls.getAzimuthalAngle() )
		.multiplyScalar( params.playerSpeed * delta );

	// Update walk animation
	const animationStep = delta * 25;
	walkAnimation = ( walkAnimation - animationStep + WALK_CYCLE_TIME ) % WALK_CYCLE_TIME;

	const cycle = ( walkAnimation / Math.PI ) % 1;
	const animationOnGround = Math.abs( cycle ) < 2 * animationStep / Math.PI || Math.abs( 1 - cycle ) < 2 * animationStep / Math.PI;
	if ( offGroundTimer < 0 && animationOnGround ) {

		walkAnimation = Math.round( walkAnimation / Math.PI ) * Math.PI;

	}

	// Apply walk direction
	if ( walkDirection.length() > 0 ) {

		_worldSegment.start.add( walkDirection );
		_worldSegment.end.add( walkDirection );

		// Rotate player to face walk direction
		_quat.setFromAxisAngle( _upVector, Math.atan2( - walkDirection.z, walkDirection.x ) );
		player.quaternion.slerp( _quat, 1 - ( 2 ** ( - delta / 0.05 ) ) );

	} else if ( animationOnGround ) {

		walkAnimation = Math.round( walkAnimation / Math.PI ) * Math.PI;

	}

	// Apply walk animation to player mesh
	playerMesh.position.y = Math.abs( Math.sin( walkAnimation ) ) * 0.6;
	playerMesh.rotation.x = Math.sin( walkAnimation ) * 0.3;

	// Get capsule AABB in scene BVH space
	getCapsuleBox( _invMat, _sceneLocalBox );

	_segmentStart.copy( _worldSegment.start );
	sceneBVH.shapecast( {

		intersectsBounds: box => box.intersectsBox( _sceneLocalBox ),

		intersectsObject: object => {

			if ( ! object.visible || object.material.transparent ) {

				return;

			}

			const { matrixWorld } = object;
			_invMat.copy( matrixWorld ).invert();

			// Get capsule AABB in object space to find nearby triangles. The collision is resolved
			// in world space since objects may be scaled non-uniformly.
			getCapsuleBox( _invMat, _objectLocalBox );

			object.geometry.boundsTree.shapecast( {

				intersectsBounds: box => box.intersectsBox( _objectLocalBox ),

				intersectsTriangle: tri => {

					_worldTriangle.a.copy( tri.a ).applyMatrix4( matrixWorld );
					_worldTriangle.b.copy( tri.b ).applyMatrix4( matrixWorld );
					_worldTriangle.c.copy( tri.c ).applyMatrix4( matrixWorld );
					_worldTriangle.needsUpdate = true;

					const triPoint = _tempVector;
					const capsulePoint = _tempVector2;

					const distance = _worldTriangle.closestPointToSegment( _worldSegment, triPoint, capsulePoint );
					if ( distance < capsuleInfo.radius ) {

						const depth = capsuleInfo.radius - distance;
						const direction = capsulePoint.sub( triPoint ).normalize();
						_worldSegment.start.addScaledVector( direction, depth );
						_worldSegment.end.addScaledVector( direction, depth );

					}

				}

			} );

		},

	} );

	// Update player position
	const deltaVector = _tempVector2;
	deltaVector.copy( capsuleInfo.segment.start ).applyMatrix4( player.matrixWorld );
	deltaVector.subVectors( _worldSegment.start, deltaVector );
	player.position.add( deltaVector );

	// Check if player is on ground
	deltaVector.subVectors( _worldSegment.start, _segmentStart );
	const touchingGround = deltaVector.y > Math.abs( delta * _playerVelocity.y * 0.25 );

	if ( touchingGround ) {

		offGroundTimer = OFF_GROUND_TIME;
		playerIsOnGround = true;
		_playerVelocity.set( 0, 0, 0 );

	} else {

		offGroundTimer -= delta;
		playerIsOnGround = false;
		_playerVelocity.addScaledVector( deltaVector, - deltaVector.dot( _playerVelocity ) );

	}

	// Reset if fallen too far
	if ( player.position.y < - 5 ) reset();

}

function updateCamera() {

	camera.position.sub( controls.target );
	controls.target.sub( player.position );

	const scalar = camera.position.length() * 0.1;
	let heightOffset = controls.target.y;
	controls.target.y = 0;

	// Limit horizontal distance
	if ( controls.target.length() > 4 * scalar ) {

		controls.target.normalize().multiplyScalar( 4 * scalar );

	}

	// Clamp height offset
	heightOffset = Math.max( 1.5 - 0.5 * scalar, Math.min( heightOffset, 1.5 + scalar ) );

	controls.target.y = heightOffset;
	controls.target.add( player.position );
	camera.position.add( controls.target );

}

function render() {

	stats.update();

	const delta = Math.min( clock.getDelta(), 0.1 );

	// Update controls based on first-person mode
	if ( params.firstPerson ) {

		controls.maxPolarAngle = Math.PI;
		controls.minDistance = controls.maxDistance = 1e-4;

	} else {

		controls.maxPolarAngle = Math.PI / 2;
		controls.minDistance = 1;
		controls.maxDistance = 20000;

	}

	if ( level ) {

		sceneHelper.visible = params.displayBVH;

		const physicsSteps = params.physicsSteps;
		for ( let i = 0; i < physicsSteps; i ++ ) {

			updatePlayer( delta / physicsSteps );

		}

	}

	updateCamera();
	controls.update();
	renderer.render( scene, camera );

}
