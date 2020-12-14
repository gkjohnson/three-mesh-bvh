import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import Stats from 'stats.js';
import { GUI } from 'dat.gui';
import { MeshBVH, MeshBVHVisualizer } from '../src/index.js';

const params = {

	model: null,
	displayCollider: false,
	displayBVH: false,
	visualizeDepth: 10,
	gravity: - 9.8,
	physicsSteps: 5,
	simulationSpeed: 1,
	pause: false,
	step: () => {

		const steps = params.physicsSteps;
		for ( let i = 0; i < steps; i ++ ) {

			update( 0.016 / steps );

		}

	},
	explode: explodeSpheres,
	reset: clearSpheres,

	// first person

};

const models = {
	'dungeon': '../models/dungeon_low_poly_game_level_challenge/scene.gltf',
	'jungle': '../models/low_poly_environment_jungle_scene/scene.gltf',
};
params.model = models[ 'jungle' ];

let renderer, camera, scene, clock, gui, outputContainer, stats;
let environment, collider, visualizer;
let spheres = [];
let hits = [];

init();
render();

function init() {

	const bgColor = 0x263238 / 2;

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.gammaOutput = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 30, 70 );

	const light = new THREE.DirectionalLight( 0xaaccff, 1 );
	light.position.set( 1, 1.5, 1 ).multiplyScalar( 50 );
	light.shadow.normalBias = 1e-1;
	light.shadow.bias = - 1e-4;
	light.shadow.mapSize.setScalar( 2048 );
	light.castShadow = true;

	const shadowCam = light.shadow.camera;
	shadowCam.bottom = shadowCam.left = - 30;
	shadowCam.top = shadowCam.right = 35;

	scene.add( light );
	scene.add( new THREE.AmbientLight( 0x4488ff, 0.3 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 20, 20, - 20 );
	camera.far = 100;
	camera.updateProjectionMatrix();
	window.camera = camera;

	clock = new THREE.Clock();

	new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	loadScene();

	gui = new GUI();
	gui.add( params, 'model', models ).onChange( loadScene );

	const visFolder = gui.addFolder( 'Visualization' );
	visFolder.add( params, 'displayCollider' );
	visFolder.add( params, 'displayBVH' );
	visFolder.add( params, 'visualizeDepth', 1, 20, 1 ).onChange( v => {

		visualizer.depth = v;
		visualizer.update();

	} );
	visFolder.open();

	const physicsFolder = gui.addFolder( 'Physics' );
	physicsFolder.add( params, 'physicsSteps', 0, 30, 1 );
	physicsFolder.add( params, 'gravity', - 100, 100, 0.01 ).onChange( v => {

		params.gravity = parseFloat( v );

	} );
	physicsFolder.add( params, 'simulationSpeed', 0, 5, 0.01 );
	physicsFolder.add( params, 'pause' );
	physicsFolder.add( params, 'step' );
	physicsFolder.open();

	gui.add( params, 'explode' );
	gui.add( params, 'reset' );
	gui.open();

	const raycaster = new THREE.Raycaster();
	const mouse = new THREE.Vector2();
	let x = 0;
	let y = 0;
	renderer.domElement.addEventListener( 'pointerdown', e => {

		x = e.clientX;
		y = e.clientY;

	} );

	renderer.domElement.addEventListener( 'pointerup', e => {

		const totalDelta = Math.abs( e.clientX - x ) + Math.abs( e.clientY - y );
		if ( totalDelta > 2 ) return;

		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
		raycaster.setFromCamera( mouse, camera );

		const sphere = createSphere();
		sphere.position.copy( camera.position ).addScaledVector( raycaster.ray.direction, 3 );
		sphere
			.velocity
			.set( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 )
			.addScaledVector( raycaster.ray.direction, 10 * Math.random() + 15 );

	} );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function loadScene() {

	clearSpheres();
	if ( collider ) {

		collider.material.dispose();
		collider.geometry.dispose();
		collider.parent.remove( collider );
		collider = null;

		environment.traverse( c => {

			if ( c.material ) {

				for ( const key in c.material ) {

					const value = c.material[ key ];
					if ( value && value.isTexture ) {

						value.dispose();

					}


				}
				c.material.dispose();
				c.geometry.dispose();

			}

		} );
		environment.parent.remove( environment );
		environment = null;

	}

	new GLTFLoader().load( params.model, res => {

		const geometries = [];
		environment = res.scene;
		environment.scale.setScalar( params.model === models.dungeon ? 0.01 : 0.1 );

		const box = new THREE.Box3();
		box.setFromObject( environment );
		box.getCenter( environment.position ).multiplyScalar( - 1 );


		const toRemove = [];
		environment.traverse( c => {

			if (
				c.name.includes( 'Enemie' ) ||
				c.name.includes( 'Character' ) ||
				c.name.includes( 'Gate' )
			) {

				toRemove.push( c );
				return;

			}

		} );
		toRemove.forEach( c => {

			c.parent.remove( c );

		} );


		environment.updateMatrixWorld( true );
		environment.traverse( c => {


			if ( c.geometry ) {

				const cloned = c.geometry.clone();
				cloned.applyMatrix4( c.matrixWorld );
				for ( const key in cloned.attributes ) {

					if ( key !== 'position' ) {

						cloned.deleteAttribute( key );

					}

				}
				geometries.push( cloned );

			}

		} );


		const mergedGeometry = BufferGeometryUtils.mergeBufferGeometries( geometries, false );
		mergedGeometry.boundsTree = new MeshBVH( mergedGeometry, { lazyGeneration: false } );

		collider = new THREE.Mesh( mergedGeometry );
		collider.material.wireframe = true;
		collider.material.opacity = 0.5;
		collider.material.transparent = true;

		scene.add( collider );

		visualizer = new MeshBVHVisualizer( collider, params.visualizeDepth );
		scene.add( visualizer );

		scene.add( environment );
		environment.traverse( c => {

			c.castShadow = true;
			c.receiveShadow = true;
			if ( c.material ) {

				c.material.shadowSide = 2;

			}

		} );

	} );

}

window.createSphere = createSphere;
const forwardVector = new THREE.Vector3( 0, 0, 1 );
function onCollide( point, normal, velocity, offset = 0 ) {

	if ( velocity < Math.max( Math.abs( 0.04 * params.gravity ), 5 ) ) {

		return;

	}

	const plane = new THREE.Mesh(
		new THREE.RingBufferGeometry( 0, 1, 30 ),
		new THREE.MeshBasicMaterial( { side: 2, transparent: true, depthWrite: false } ),
	);
	plane.lifetime = 0;
	plane.maxLifetime = 0.4;
	plane.maxScale = Math.max( Math.sin( Math.min( velocity / 300, 2 ) * Math.PI / 2 ), 0.5 );

	plane.position.copy( point ).addScaledVector( normal, offset );
	plane.quaternion.setFromUnitVectors( forwardVector, normal );
	scene.add( plane );
	hits.push( plane );


}

function createSphere() {

	const white = new THREE.Color( 0xffffff );
	const color = new THREE.Color( 0x263238 / 2 ).lerp( white, Math.random() * 0.5 + 0.5 ).convertSRGBToLinear();
	const sphere = new THREE.Mesh(
		new THREE.SphereBufferGeometry( 1, 20, 20 ),
		new THREE.MeshStandardMaterial( { color } )
	);
	scene.add( sphere );
	sphere.castShadow = true;
	sphere.receiveShadow = true;
	sphere.material.shadowSide = 2;

	const radius = Math.random() * .6 + 0.2;
	sphere.scale.setScalar( radius );
	sphere.collider = new THREE.Sphere( new THREE.Vector3(), 1 );
	sphere.velocity = new THREE.Vector3( 0, 0, 0 );
	sphere.mass = Math.pow( radius, 3 ) * Math.PI * 4 / 3;

	spheres.push( sphere );
	return sphere;

}

const tempSphere = new THREE.Sphere();
const tempSphere2 = new THREE.Sphere();
const deltaVec = new THREE.Vector3();
const tempVec = new THREE.Vector3();
function updateSpheres( deltaTime ) {

	// TODO: Add visualization for velocity vector, collision vector, all intersection vectors
	// TODO: Add smoke effect or similar if wall or other ball is hit at certain speed
	const bvh = collider.geometry.boundsTree;
	for ( let i = 0, l = spheres.length; i < l; i ++ ) {

		const sphere = spheres[ i ];

		// move the sphere
		sphere.velocity.y += params.gravity * deltaTime;
		sphere.position.addScaledVector( sphere.velocity, deltaTime );
		sphere.updateMatrixWorld();

		// remove the spheres if they've left the world
		if ( sphere.position.y < - 80 ) {

			spheres.splice( i, 1 );
			i --;
			l --;

			sphere.material.dispose();
			sphere.geometry.dispose();
			scene.remove( sphere );
			continue;

		}

		// get the sphere position in world space
		tempSphere.copy( sphere.collider );
		tempSphere.applyMatrix4( sphere.matrixWorld );

		let collided = false;
		bvh.shapecast(
			collider,
			box => {

				return box.intersectsSphere( tempSphere );

			},
			tri => {

				// get delta between closest point and center
				tri.closestPointToPoint( tempSphere.center, deltaVec );
				deltaVec.sub( tempSphere.center );
				const distance = deltaVec.length();
				if ( distance < tempSphere.radius ) {

					// move the sphere position to be outside the triangle
					const radius = tempSphere.radius;
					const depth = distance - radius;
					deltaVec.multiplyScalar( 1 / distance );
					tempSphere.center.addScaledVector( deltaVec, depth );

					collided = true;

				}

			},
			box => {

				return box.distanceToPoint( tempSphere.center ) - tempSphere.radius;

			} );

		if ( collided ) {

			deltaVec.subVectors( tempSphere.center, sphere.position ).normalize();
			sphere.velocity.reflect( deltaVec );

			const ogVelocity = sphere.velocity.length();
			const dot = sphere.velocity.dot( deltaVec );
			sphere.velocity.addScaledVector( deltaVec, - dot * 0.5 );
			sphere.position.copy( tempSphere.center );
			sphere.velocity.multiplyScalar( Math.max( 1.0 - deltaTime, 0 ) );

			tempVec.copy( tempSphere.center ).addScaledVector( deltaVec, - tempSphere.radius );
			onCollide( tempVec, deltaVec, ogVelocity * dot, 0.05 );

		}

		sphere.updateMatrixWorld();

	}

	for ( let i = 0, l = spheres.length; i < l; i ++ ) {

		const s1 = spheres[ i ];
		const c1 = tempSphere.copy( s1.collider ).applyMatrix4( s1.matrixWorld );
		for ( let j = i + 1; j < l; j ++ ) {

			const s2 = spheres[ j ];
			const c2 = tempSphere2.copy( s2.collider ).applyMatrix4( s2.matrixWorld );

			deltaVec.subVectors( c1.center, c2.center );

			const depth = deltaVec.length() - ( c1.radius + c2.radius );
			if ( depth < 0 ) {

				deltaVec.normalize();

				// shift the spheres outside of each other
				const v1dot = s1.velocity.dot( deltaVec );
				const v2dot = s2.velocity.dot( deltaVec );

				const offsetRatio1 = Math.max( v1dot, 0.2 );
				const offsetRatio2 = Math.max( v2dot, 0.2 );

				const total = offsetRatio1 + offsetRatio2;
				const ratio1 = offsetRatio1 / total;
				const ratio2 = offsetRatio2 / total;

				// correct the positioning of the spheres
				c1.center.addScaledVector( deltaVec, - ratio1 * depth );
				c2.center.addScaledVector( deltaVec, ratio2 * depth );

				// momentum
				const velocityDifference = new THREE.Vector3();
				velocityDifference
					.addScaledVector( deltaVec, - v1dot )
					.addScaledVector( deltaVec, v2dot );

				const velDiff = velocityDifference.length();
				const m1 = s1.mass;
				const m2 = s2.mass;

				let newv1, newv2;
				if ( velocityDifference.dot( s1.velocity ) > velocityDifference.dot( s2.velocity ) ) {

					newv1 = 0.5 * velDiff * ( m1 - m2 ) / ( m1 + m2 ) - velDiff;
					newv2 = 0.5 * velDiff * 2 * m1 / ( m1 + m2 );

				} else {

					newv1 = 0.5 * velDiff * 2 * m2 / ( m1 + m2 );
					newv2 = 0.5 * velDiff * ( m2 - m1 ) / ( m1 + m2 ) - velDiff;

				}

				velocityDifference.normalize();
				s1.velocity.addScaledVector( velocityDifference, newv1 );
				s2.velocity.addScaledVector( velocityDifference, newv2 );

				s1.position.copy( c1.center );
				s2.position.copy( c2.center );
				s1.updateMatrixWorld();
				s2.updateMatrixWorld();

				tempVec.copy( c1.center ).addScaledVector( deltaVec, - c1.radius );
				onCollide( tempVec, deltaVec, total, 0 );


			}

		}

	}

}

function clearSpheres() {

	spheres.forEach( s => {

		s.material.dispose();
		s.geometry.dispose();
		scene.remove( s );

	} );
	spheres.length = 0;

}

function explodeSpheres() {

	const temp = new THREE.Vector3();
	spheres.forEach( s => {

		temp.copy( s.position );
		temp.y += 10;
		temp.normalize();
		s.velocity.addScaledVector( temp, 120 );

	} );

}

function update( delta ) {

	if ( collider ) {

		const steps = params.physicsSteps;
		for ( let i = 0; i < steps; i ++ ) {

			updateSpheres( delta / steps );

		}

	}

	for ( let i = 0, l = hits.length; i < l; i ++ ) {

		const hit = hits[ i ];
		hit.lifetime += delta;

		const ratio = hit.lifetime / hit.maxLifetime;
		let scale = Math.sin( ratio * 4.5 * Math.PI / 4 );
		scale = 1.0 - Math.pow( 1.0 - scale, 2 );
		hit.scale.setScalar( scale * hit.maxScale );
		hit.material.opacity = 1.0 - Math.sin( ratio * 2 * Math.PI / 4 );

		if ( ratio >= 1 ) {

			hits.splice( i, 1 );
			hit.parent.remove( hit );
			hit.geometry.dispose();
			hit.material.dispose();
			i --;
			l --;

		}

	}

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	const delta = Math.min( clock.getDelta(), 0.1 );

	if ( collider ) {

		collider.visible = params.displayCollider;
		visualizer.visible = params.displayBVH;

		if ( ! params.pause ) {

			update( params.simulationSpeed * delta );

		}

	}

	renderer.render( scene, camera );

}
