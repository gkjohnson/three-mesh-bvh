import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { MeshBVH, BVHHelper, StaticGeometryGenerator } from 'three-mesh-bvh';

const params = {
	displayCollider: false,
	displayBVH: false,
	displayParents: false,
	displayDepth: 10,
	gravity: - 9.8,
	physicsSteps: 5,
	simulationSpeed: 1,
	sphereSize: 1,
	pause: false,
	step: () => {

		const steps = params.physicsSteps;
		for ( let i = 0; i < steps; i ++ ) update( 0.016 / steps );

	},
	explode: () => {

		const temp = new THREE.Vector3();
		spheres.forEach( s => {

			temp.copy( s.position );
			temp.y += 10;
			temp.normalize();
			s.velocity.addScaledVector( temp, 120 );

		} );

	},
	reset: () => {

		spheres.forEach( s => {

			s.material.dispose();
			s.geometry.dispose();
			scene.remove( s );

		} );
		spheres.length = 0;

		hits.forEach( h => {

			h.material.dispose();
			h.geometry.dispose();
			scene.remove( h );

		} );
		hits.length = 0;

	},
};

let renderer, camera, scene, clock, stats;
let environment, collider, bvhHelper;
const spheres = [];
const hits = [];
const tempSphere = new THREE.Sphere();
const deltaVec = new THREE.Vector3();
const tempVec = new THREE.Vector3();
const forwardVector = new THREE.Vector3( 0, 0, 1 );

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
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 30, 70 );

	// Lights
	const light = new THREE.DirectionalLight( 0xaaccff, 1.5 );
	light.position.set( 50, 75, 50 );

	const shadowCam = light.shadow.camera;
	shadowCam.left = shadowCam.bottom = - 10;
	shadowCam.top = shadowCam.right = 10;

	scene.add(
		light,
		new THREE.HemisphereLight( 0x8dc1ff, 0x667c8d, 1.2 )
	);

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
	camera.position.set( 10, 10, - 10 );

	clock = new THREE.Clock();
	new OrbitControls( camera, renderer.domElement );

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// Load environment
	loadColliderEnvironment();

	// GUI
	const gui = new GUI();

	const visFolder = gui.addFolder( 'Visualization' );
	visFolder.add( params, 'displayCollider' );
	visFolder.add( params, 'displayBVH' );
	visFolder.add( params, 'displayParents' ).onChange( v => {

		bvhHelper.displayParents = v;
		bvhHelper.update();

	} );
	visFolder.add( params, 'displayDepth', 1, 20, 1 ).onChange( v => {

		bvhHelper.depth = v;
		bvhHelper.update();

	} );
	visFolder.open();

	const physicsFolder = gui.addFolder( 'Physics' );
	physicsFolder.add( params, 'physicsSteps', 0, 30, 1 );
	physicsFolder.add( params, 'gravity', - 100, 100, 0.01 );
	physicsFolder.add( params, 'simulationSpeed', 0, 5, 0.01 );
	physicsFolder.add( params, 'sphereSize', 0.2, 5, 0.1 );
	physicsFolder.add( params, 'pause' );
	physicsFolder.add( params, 'step' );
	physicsFolder.open();

	gui.add( params, 'explode' );
	gui.add( params, 'reset' );
	gui.open();

	// Event listeners
	const raycaster = new THREE.Raycaster();
	const mouse = new THREE.Vector2();
	let pointerDownX = 0;
	let pointerDownY = 0;

	renderer.domElement.addEventListener( 'pointerdown', e => {

		pointerDownX = e.clientX;
		pointerDownY = e.clientY;

	} );

	renderer.domElement.addEventListener( 'pointerup', e => {

		const totalDelta = Math.abs( e.clientX - pointerDownX ) + Math.abs( e.clientY - pointerDownY );
		if ( totalDelta > 2 ) return;

		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
		raycaster.setFromCamera( mouse, camera );

		const sphere = createSphere();
		sphere.position.copy( camera.position ).addScaledVector( raycaster.ray.direction, 3 );
		sphere.velocity
			.set( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 )
			.addScaledVector( raycaster.ray.direction, 10 * Math.random() + 15 )
			.multiplyScalar( 0.5 );

	} );

	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

	window.createSphere = createSphere;

}

function loadColliderEnvironment() {

	new GLTFLoader().load(
		'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/low-poly-jungle-scene/scene.gltf',
		res => {

			environment = res.scene;
			environment.scale.setScalar( 0.05 );

			// Add point lights
			const pointLight = new THREE.PointLight( 0x00ffff, 9, 7 );
			pointLight.position.set( - 100, - 40, 100 );
			environment.add( pointLight );

			const porchLight = new THREE.PointLight( 0xffdd66, 5, 15 );
			porchLight.position.set( 80, 80, 135 );
			porchLight.shadow.normalBias = 1e-2;
			porchLight.shadow.bias = - 1e-3;
			porchLight.shadow.mapSize.setScalar( 1024 );
			porchLight.castShadow = true;
			environment.add( porchLight );

			// Generate merged collision geometry
			environment.updateMatrixWorld( true );

			const staticGenerator = new StaticGeometryGenerator( environment );
			staticGenerator.attributes = [ 'position' ];

			const mergedGeometry = staticGenerator.generate();
			mergedGeometry.boundsTree = new MeshBVH( mergedGeometry );

			collider = new THREE.Mesh( mergedGeometry );
			collider.material.wireframe = true;
			collider.material.opacity = 0.5;
			collider.material.transparent = true;

			bvhHelper = new BVHHelper( collider, params.displayDepth );

			scene.add( bvhHelper, collider, environment );

			environment.traverse( c => {

				if ( c.material ) {

					c.castShadow = c.receiveShadow = true;
					c.material.shadowSide = 2;

				}

			} );

		}
	);

}

function onCollide( object1, object2, point, normal, velocity, offset = 0 ) {

	if ( velocity < Math.max( Math.abs( 0.04 * params.gravity ), 5 ) ) return;

	// Create collision effect
	const effectScale = Math.max(
		object2 ?
			Math.max( object1.collider.radius, object2.collider.radius ) :
			object1.collider.radius,
		0.4
	) * 2.0;

	const plane = new THREE.Mesh(
		new THREE.RingGeometry( 0, 1, 30 ),
		new THREE.MeshBasicMaterial( { side: 2, transparent: true, depthWrite: false } )
	);
	plane.lifetime = 0;
	plane.maxLifetime = 0.4;
	plane.maxScale = effectScale * Math.max( Math.sin( Math.min( velocity / 200, 1 ) * Math.PI / 2 ), 0.35 );

	plane.position.copy( point ).addScaledVector( normal, offset );
	plane.quaternion.setFromUnitVectors( forwardVector, normal );
	scene.add( plane );
	hits.push( plane );

}

function createSphere() {

	const white = new THREE.Color( 0xffffff );
	const color = new THREE.Color( 0x131619 ).lerp( white, Math.random() * 0.5 + 0.5 );
	const sphere = new THREE.Mesh(
		new THREE.SphereGeometry( 1, 20, 20 ),
		new THREE.MeshStandardMaterial( { color } )
	);
	scene.add( sphere );
	sphere.castShadow = sphere.receiveShadow = true;
	sphere.material.shadowSide = 2;

	const radius = 0.5 * params.sphereSize * ( Math.random() * 0.2 + 0.6 );
	sphere.scale.setScalar( radius );
	sphere.collider = new THREE.Sphere( sphere.position, radius );
	sphere.velocity = new THREE.Vector3( 0, 0, 0 );
	sphere.mass = Math.pow( radius, 3 ) * Math.PI * 4 / 3;

	spheres.push( sphere );
	return sphere;

}

function updateSphereCollisions( deltaTime ) {

	const bvh = collider.geometry.boundsTree;

	for ( let i = 0, l = spheres.length; i < l; i ++ ) {

		const sphere = spheres[ i ];
		const sphereCollider = sphere.collider;

		// Apply gravity and move sphere
		sphere.velocity.y += params.gravity * deltaTime;
		sphereCollider.center.addScaledVector( sphere.velocity, deltaTime );

		// Remove spheres that fell out of the world
		if ( sphereCollider.center.y < - 80 ) {

			spheres.splice( i, 1 );
			i --;
			l --;

			sphere.material.dispose();
			sphere.geometry.dispose();
			scene.remove( sphere );
			continue;

		}

		// Check collision with environment
		tempSphere.copy( sphere.collider );

		let collided = false;
		bvh.shapecast( {

			intersectsBounds: box => box.intersectsSphere( tempSphere ),

			intersectsTriangle: tri => {

				tri.closestPointToPoint( tempSphere.center, deltaVec );
				deltaVec.sub( tempSphere.center );
				const distance = deltaVec.length();

				if ( distance < tempSphere.radius ) {

					const radius = tempSphere.radius;
					const depth = distance - radius;
					deltaVec.multiplyScalar( 1 / distance );
					tempSphere.center.addScaledVector( deltaVec, depth );

					collided = true;

				}

			},

			boundsTraverseOrder: box => box.distanceToPoint( tempSphere.center ) - tempSphere.radius,

		} );

		if ( collided ) {

			deltaVec.subVectors( tempSphere.center, sphereCollider.center ).normalize();
			sphere.velocity.reflect( deltaVec );

			const dot = sphere.velocity.dot( deltaVec );
			sphere.velocity.addScaledVector( deltaVec, - dot * 0.5 );
			sphere.velocity.multiplyScalar( Math.max( 1.0 - deltaTime, 0 ) );

			sphereCollider.center.copy( tempSphere.center );

			tempVec.copy( tempSphere.center ).addScaledVector( deltaVec, - tempSphere.radius );
			onCollide( sphere, null, tempVec, deltaVec, dot, 0.05 );

		}

	}

	// Handle sphere-sphere collisions
	for ( let i = 0, l = spheres.length; i < l; i ++ ) {

		const s1 = spheres[ i ];
		const c1 = s1.collider;

		for ( let j = i + 1; j < l; j ++ ) {

			const s2 = spheres[ j ];
			const c2 = s2.collider;

			deltaVec.subVectors( c1.center, c2.center );
			const depth = deltaVec.length() - ( c1.radius + c2.radius );

			if ( depth < 0 ) {

				deltaVec.normalize();

				const v1dot = s1.velocity.dot( deltaVec );
				const v2dot = s2.velocity.dot( deltaVec );

				const offsetRatio1 = Math.max( v1dot, 0.2 );
				const offsetRatio2 = Math.max( v2dot, 0.2 );

				const total = offsetRatio1 + offsetRatio2;
				const ratio1 = offsetRatio1 / total;
				const ratio2 = offsetRatio2 / total;

				c1.center.addScaledVector( deltaVec, - ratio1 * depth );
				c2.center.addScaledVector( deltaVec, ratio2 * depth );

				const velocityDifference = new THREE.Vector3();
				velocityDifference
					.addScaledVector( deltaVec, - v1dot )
					.addScaledVector( deltaVec, v2dot );

				const velDiff = velocityDifference.length();
				const m1 = s1.mass;
				const m2 = s2.mass;

				let newVel1, newVel2;
				const damping = 0.5;

				if ( velocityDifference.dot( s1.velocity ) > velocityDifference.dot( s2.velocity ) ) {

					newVel1 = damping * velDiff * ( m1 - m2 ) / ( m1 + m2 );
					newVel2 = damping * velDiff * 2 * m1 / ( m1 + m2 );
					newVel1 -= velDiff;

				} else {

					newVel1 = damping * velDiff * 2 * m2 / ( m1 + m2 );
					newVel2 = damping * velDiff * ( m2 - m1 ) / ( m1 + m2 );
					newVel2 -= velDiff;

				}

				velocityDifference.normalize();
				s1.velocity.addScaledVector( velocityDifference, newVel1 );
				s2.velocity.addScaledVector( velocityDifference, newVel2 );

				tempVec.copy( c1.center ).addScaledVector( deltaVec, - c1.radius );
				onCollide( s1, s2, tempVec, deltaVec, velDiff, 0 );

			}

		}

		s1.position.copy( c1.center );

	}

}

function update( delta ) {

	if ( collider ) {

		const steps = params.physicsSteps;
		for ( let i = 0; i < steps; i ++ ) updateSphereCollisions( delta / steps );

	}

	// Update collision effects
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

	const delta = Math.min( clock.getDelta(), 0.1 );

	if ( collider ) {

		collider.visible = params.displayCollider;
		bvhHelper.visible = params.displayBVH;

		if ( ! params.pause ) update( params.simulationSpeed * delta );

	}

	renderer.render( scene, camera );

}
