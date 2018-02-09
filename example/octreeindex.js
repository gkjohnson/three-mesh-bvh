import * as THREE from '../node_modules/three/build/three.module.js'
import Stats from '../node_modules/stats.js/src/Stats.js'
import OctreeVisualizer from '../lib/OctreeVisualizer.js'
import Octree from '../lib/Octree.js'
import '../index.js'

const bgColor = 0x263238 / 2;

// renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(bgColor, 1);
document.body.appendChild(renderer.domElement);

// scene setup
const scene = new THREE.Scene();
const light = new THREE.DirectionalLight(0xffffff, 0.5);
light.position.set(1,1,1);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.4))

// geometry setup
const radius = 1;
const tube = .4;
const tubularSegments = 400;
const radialSegments = 100;

let boundsViz = null;
const containerObj = new THREE.Object3D();
// const geom = new THREE.TorusKnotBufferGeometry(.5, .2, 40, 10);
const geom = new THREE.SphereBufferGeometry(1, 30, 30);
const material = new THREE.MeshPhongMaterial({ color: 0xE91E63 });

geom.computeBoundsTree()

scene.add(containerObj);

// camera setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50);
camera.position.z = 60;
camera.far = 1000;
camera.updateProjectionMatrix()

// stats setup
const stats = new Stats();
document.body.appendChild(stats.dom);

// Delta timer
let lastFrameTime = null;
let deltaTime = 0;
const knots = [];

const octree = new Octree();
window.octree = octree;

const addMesh = () => {
    const mesh = new THREE.Mesh(geom, material);
    mesh.rotation.x = Math.random() * 10;
    mesh.rotation.y = Math.random() * 10;
    knots.push(mesh);
    containerObj.add(mesh);



    const dist = Math.random() * 40 - 20;
    const scale = Math.random() * 7.5 + 2.5;
    mesh.scale.set(1, 1, 1).multiplyScalar(scale);

    const vec3 = new THREE.Vector3(0, 1, 0);
    vec3.applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * Math.random());
    vec3.applyAxisAngle(new THREE.Vector3(0, 1, 0), 2 * Math.PI * Math.random());
    vec3.multiplyScalar(dist)

    mesh.position.set(vec3.x, vec3.y, vec3.z);
    // mesh.position.set(2,3,6);
    // mesh.scale.set(10,10,10);


    mesh.updateMatrix();
    mesh.updateMatrixWorld();



    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
    mesh.boundingSphere = mesh.geometry.boundingSphere.clone();
    mesh.boundingSphere.applyMatrix4(mesh.matrixWorld);

    return mesh;
}

scene.add(new THREE.AxesHelper())

window.add = (x = 0, y = 0, z = 0, s = 10) => {
    const o = addMesh();
    o.position.set(x,y,z);
    o.scale.set(1,1,1).multiplyScalar(s);

    // const c = o;

    // const dist = Math.random() * 40 - 20;
    // const scale = Math.random() * 7.5 + 2.5;
    // c.scale.set(1, 1, 1).multiplyScalar(scale);

    // const vec3 = new THREE.Vector3(0, 1, 0);
    // vec3.applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * Math.random());
    // vec3.applyAxisAngle(new THREE.Vector3(0, 1, 0), 2 * Math.PI * Math.random());
    // vec3.multiplyScalar(dist)

    // c.position.set(vec3.x, vec3.y, vec3.z);



    o.updateMatrix();
    o.updateMatrixWorld();

    o.boundingSphere.copy(o.geometry.boundingSphere);
    o.boundingSphere.applyMatrix4(o.matrixWorld);

    // o.geometry.computeBoundingSphere();    

    // const sphere = o.geometry.boundingSphere.clone();
    // sphere.applyMatrix4(o.matrixWorld);
    // o.boundingSphere = sphere;
    octree.add(o)
    // octree.remove(o);
    // containerObj.remove(o);

    return o;
}

// window.add();
// window.add(2, 2, 2, 10)

boundsViz = new OctreeVisualizer(octree);
scene.add(boundsViz);


const sphere = new THREE.SphereGeometry(1,1,1);
const raymat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const raysphere = [];
for (let i = 0; i < 50; i ++) {
    const origMesh = new THREE.Mesh(sphere, raymat);
    origMesh.scale.set(1,1,1).multiplyScalar(.25);
    scene.add(origMesh);
    raysphere.push(origMesh);
}


// for(let x = -1; x <= 1; x += 1)
//     for(let y = -1; y <= 1; y += 1)
//         for(let z = -1; z <= 1; z += 1) {
//             const o = addMesh();
//             o.position.set(x,y,z).multiplyScalar(20);
//         }


// knots.forEach(c => {
//     c.updateMatrix();
//     c.updateMatrixWorld();
//     c.boundingSphere.copy(c.geometry.boundingSphere);
//     c.boundingSphere.applyMatrix4(c.matrixWorld);
//     octree.update(c);
// })



window.setRay = (x,y,z, dx,dy,dz) => {

    knots.forEach(o => {
        o.material = material;
    })

    const r = new THREE.Ray(new THREE.Vector3(x,y,z), new THREE.Vector3(dx,dy,dz).normalize());
    const rc = new THREE.Raycaster();
    rc.ray.copy(r);

    console.time('oct raycast')
    const intersects = []
    const res2 = octree.raycastFirst(rc, intersects);
    if (res2) intersects.push(res2)

    console.log(res2)
    console.log(intersects)
    console.timeEnd('oct raycast')

    console.time('OBJ')
    const res = rc.intersectObject(scene, true);
    console.log(res);
    console.timeEnd('OBJ')


    const c1 = res ? res.map(i => i.distance) : [];
    const c2 = intersects ? intersects.map(i => i.distance) : [];

    console.log('SAME', c1.join(',') === c2.join(','));

    
    const p = new THREE.Vector3();
    p.copy(r.origin);

    raysphere.forEach((o, i) => {

        p.x += r.direction.x * 1;
        p.y += r.direction.y * 1;
        p.z += r.direction.z * 1;

        o.position.copy(p);
    });
}

// {x: -9.90173989091766, y: -9.90173989091766, z: 1.3984087859456258}
const obj = window.add(-9.9, -9.9, -1.4, 1)

window.sphere = obj;

const arr = [];
for (let i = 0 ; i < 5000 ; i ++ ) {
    arr.push(window.add(Math.random() * 40 - 20, Math.random() * 40 - 20, Math.random() * 40 - 20, Math.random() * 1));


    const o = arr[i];
    // o.position.y = Math.sin(i) * 10;
    // o.position.z = Math.cos(i) * 10;
    o.updateMatrix();
    o.updateMatrixWorld();
    o.boundingSphere.copy(o.geometry.boundingSphere);
    o.boundingSphere.applyMatrix4(o.matrixWorld);
    octree.update(o);
}

octree._runObjectActions()
octree._runNodeUpdates()

// window.dogo = true;
window.setRay(1, 1, 1, -1, -1, -1)


const render = () => {
    controls.update();
    stats.begin();

    const t = 0 //window.performance.now();

    // arr.forEach((o, i) => {
    //     o.position.y = Math.sin(t * 0.001 + i) * 10;
    //     o.position.z = Math.cos(t * 0.001 + i) * 10;
    //     // o.position.x = Math.sin(t * 0.001 + i) * 10;
    //     o.updateMatrix();
    //     o.updateMatrixWorld();
    //     o.boundingSphere.copy(o.geometry.boundingSphere);
    //     o.boundingSphere.applyMatrix4(o.matrixWorld);
    //     octree.update(o);
    // })


    if (window.dogo) {
        obj.position.y = Math.sin(t * 0.001) * 10;
        obj.position.z = Math.cos(t * 0.001) * 10;
        obj.position.x = Math.sin(t * 0.001) * 10;
        obj.updateMatrix();
        obj.updateMatrixWorld();
        obj.boundingSphere.copy(obj.geometry.boundingSphere);
        obj.boundingSphere.applyMatrix4(obj.matrixWorld);
        octree.update(obj);
    }


    const currTime = window.performance.now();
    lastFrameTime = lastFrameTime || currTime;
    deltaTime = currTime - lastFrameTime;

    // containerObj.rotation.x += 0.0001 * options.mesh.speed * deltaTime;
    // containerObj.rotation.y += 0.0001 * options.mesh.speed * deltaTime;
    containerObj.updateMatrixWorld();

    if(boundsViz) boundsViz.update();

    renderer.render(scene, camera);

    lastFrameTime = currTime;

    stats.end();
    
    requestAnimationFrame(render);
}



window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
}, false);




const controls = new window.THREE.OrbitControls(camera);

render();


