import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { MeshBVH, BVHHelper } from 'three-mesh-bvh';
import { ObjectBVH } from './src/bvh/ObjectBVH.js';

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
const _sceneLocalBox = new THREE.Box3();
const _objectLocalBox = new THREE.Box3();
const _invMat = new THREE.Matrix4();
const _worldSegment = new THREE.Line3();
const _localSegment = new THREE.Line3();
const _sphere = new THREE.Sphere();

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

	new GLTFLoader().load( new URL( './models/grandmas_house_compressed.glb', import.meta.url ).toString(), res => {

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
		sceneBVH = new ObjectBVH( level, { maxLeafSize: 1 } );

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

	// Calculate walk direction
	const angle = controls.getAzimuthalAngle();
	const walkDirection = new THREE.Vector3();
	const directions = [
		{ key: keys.fwd, vec: [ 0, 0, - 1 ] },
		{ key: keys.bkd, vec: [ 0, 0, 1 ] },
		{ key: keys.lft, vec: [ - 1, 0, 0 ] },
		{ key: keys.rgt, vec: [ 1, 0, 0 ] },
	];

	for ( const { key, vec } of directions ) {

		if ( key ) {

			_tempVector.set( ...vec ).applyAxisAngle( _upVector, angle );
			walkDirection.addScaledVector( _tempVector, params.playerSpeed * delta );

		}

	}

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
		const right = new THREE.Vector3( 1, 0, 0 );
		const walkAngle = right.angleTo( walkDirection.normalize() );
		right.cross( walkDirection );

		const quat = new THREE.Quaternion().setFromAxisAngle( _upVector, Math.sign( right.y ) * walkAngle );
		player.quaternion.slerp( quat, 1 - ( 2 ** ( - delta / 0.05 ) ) );

	} else if ( animationOnGround ) {

		walkAnimation = Math.round( walkAnimation / Math.PI ) * Math.PI;

	}

	// Apply walk animation to player mesh
	playerMesh.position.y = Math.abs( Math.sin( walkAnimation ) ) * 0.6;
	playerMesh.rotation.x = Math.sin( walkAnimation ) * 0.3;

	// Get capsule AABB in scene BVH space
	_sceneLocalBox.makeEmpty();
	_sceneLocalBox.expandByPoint( _worldSegment.start );
	_sceneLocalBox.expandByPoint( _worldSegment.end );
	_sceneLocalBox.min.addScalar( - capsuleInfo.radius );
	_sceneLocalBox.max.addScalar( capsuleInfo.radius );
	_sceneLocalBox.applyMatrix4( _invMat );

	const segmentStart = _worldSegment.start.clone();
	sceneBVH.shapecast( {

		intersectsBounds: box => box.intersectsBox( _sceneLocalBox ),

		intersectsObject: object => {

			if ( ! object.visible || object.material.transparent ) {

				return;

			}

			_invMat.copy( object.matrixWorld ).invert();

			// Get capsule AABB in object space
			_objectLocalBox.makeEmpty();
			_objectLocalBox.expandByPoint( _worldSegment.start );
			_objectLocalBox.expandByPoint( _worldSegment.end );
			_objectLocalBox.min.addScalar( - capsuleInfo.radius );
			_objectLocalBox.max.addScalar( capsuleInfo.radius );
			_objectLocalBox.applyMatrix4( _invMat );

			// Get segment and sphere in local space
			_localSegment.copy( _worldSegment ).applyMatrix4( _invMat );
			_sphere.radius = capsuleInfo.radius;
			_sphere.applyMatrix4( _invMat );
			const localRadius = _sphere.radius;

			object.geometry.boundsTree.shapecast( {

				intersectsBounds: box => box.intersectsBox( _objectLocalBox ),

				intersectsTriangle: tri => {

					const triPoint = _tempVector;
					const capsulePoint = _tempVector2;

					const distance = tri.closestPointToSegment( _localSegment, triPoint, capsulePoint );
					if ( distance < localRadius ) {

						const depth = localRadius - distance;
						const direction = capsulePoint.sub( triPoint ).normalize();
						_localSegment.start.addScaledVector( direction, depth );
						_localSegment.end.addScaledVector( direction, depth );

					}

				}

			} );

			_worldSegment.copy( _localSegment ).applyMatrix4( object.matrixWorld );

		},

	} );

	// Update player position
	const deltaVector = _tempVector2;
	deltaVector.copy( capsuleInfo.segment.start ).applyMatrix4( player.matrixWorld );
	deltaVector.subVectors( _worldSegment.start, deltaVector );
	player.position.add( deltaVector );

	// Check if player is on ground
	deltaVector.copy( segmentStart ).subVectors( _worldSegment.start, deltaVector );
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
