import * as THREE from 'three';
import { GUI } from 'https://unpkg.com/three@0.144.0/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'https://unpkg.com/three@0.144.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.144.0/examples/jsm/loaders/GLTFLoader.js';
import { GenerateMeshBVHWorker } from '../src/workers/GenerateMeshBVHWorker.js';
//import { acceleratedRaycast, MeshBVH, MeshBVHVisualizer } from '..';
import {
    MeshBVH,
    MeshBVHVisualizer,
    MeshBVHUniformStruct,
    FloatVertexAttributeTexture,
    shaderStructs,
    shaderIntersectFunction,
    SAH
} from '../src/index.js';

let scene, camera, renderer, environment, controls, diamond, effectController, gui, stats;
init();

async function init() {
    // Setup basic renderer, controls, and profiler
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(50, 75, 50);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    environment = new THREE.CubeTextureLoader().load([
        "textures/skybox/Box_Right.bmp",
        "textures/skybox/Box_Left.bmp",
        "textures/skybox/Box_Top.bmp",
        "textures/skybox/Box_Bottom.bmp",
        "textures/skybox/Box_Front.bmp",
        "textures/skybox/Box_Back.bmp"
    ]);
    environment.encoding = THREE.sRGBEncoding;
    scene.background = environment;
    controls = new OrbitControls(camera, renderer.domElement);
    //controls.target.set(0, 25, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.body.appendChild(renderer.domElement);
    effectController = {
        bounces: 3.0,
        ior: 2.4,
        correctMips: true
    };
    const diamondGeo = (await new GLTFLoader().loadAsync("models/diamond.glb")).scene.children[0].children[0].children[0].children[0].children[0].geometry;
    diamondGeo.scale(10, 10, 10);
    const bvh = new MeshBVH(diamondGeo.toNonIndexed(), { lazyGeneration: false, strategy: SAH });
    const diamondMaterial = new THREE.ShaderMaterial({
        uniforms: {
            envMap: { value: environment },
            bvh: { value: new MeshBVHUniformStruct() },
            bounces: { value: 3 },
            color: { value: new THREE.Color(1, 1, 1) },
            ior: { value: 2.4 },
            correctMips: { value: true },
            projectionMatrixInv: { value: camera.projectionMatrixInverse },
            viewMatrixInv: { value: camera.matrixWorld },
            resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: /*glsl*/ `
            varying vec3 vWorldPosition;
            varying vec3 vNormal;
            uniform mat4 viewMatrixInv;
            void main() {
                vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                vNormal = (viewMatrixInv * vec4(normalMatrix * normal, 0.0)).xyz;
                gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
            }
    `,
        fragmentShader: /*glsl*/ `
            precision highp isampler2D;
            precision highp usampler2D;
            varying vec3 vWorldPosition;
            varying vec3 vNormal;
            uniform samplerCube envMap;
            uniform float bounces;
            ${ shaderStructs }
            ${ shaderIntersectFunction }
            uniform BVH bvh;
            uniform float ior;
            uniform vec3 color;
            uniform bool correctMips;
            uniform mat4 projectionMatrixInv;
            uniform mat4 viewMatrixInv;
            uniform vec2 resolution;
            void main() {
                vec2 uv = gl_FragCoord.xy / resolution;
                vec3 directionCamPerfect = (projectionMatrixInv * vec4(uv * 2.0 - 1.0, 0.0, 1.0)).xyz;
                directionCamPerfect = (viewMatrixInv * vec4(directionCamPerfect, 0.0)).xyz;
                directionCamPerfect = normalize(directionCamPerfect);
                vec3 normal = vNormal;
                vec3 rayOrigin = vec3(cameraPosition);
                vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
                rayDirection = refract(rayDirection, normal, 1.0 / ior);
                rayOrigin = vWorldPosition + rayDirection * 0.001;
                for(float i = 0.0; i < bounces; i++) {
                    uvec4 faceIndices = uvec4( 0u );
                    vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
                    vec3 barycoord = vec3( 0.0 );
                    float side = 1.0;
                    float dist = 0.0;
                    bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
                    vec3 hitPos = rayOrigin + rayDirection * max(dist - 0.001, 0.0);
                // faceNormal *= side;
                    vec3 tempDir = refract(rayDirection, faceNormal, ior);
                    if (length(tempDir) != 0.0) {
                        rayDirection = tempDir;
                        break;
                    }
                    rayDirection = reflect(rayDirection, faceNormal);
                    rayOrigin = hitPos + rayDirection * 0.01;
                }
                vec3 finalColor = textureGrad(envMap, rayDirection, dFdx(correctMips ? directionCamPerfect: rayDirection), dFdy(correctMips ? directionCamPerfect: rayDirection)).rgb * color;
                gl_FragColor = LinearTosRGB(vec4(vec3(finalColor), 1.0));
            }
    `
    });
    diamondMaterial.uniforms.bvh.value.updateFrom(bvh);
    diamond = new THREE.Mesh(diamondGeo, diamondMaterial);
    scene.add(diamond);
    gui = new GUI();
    gui.add(effectController, "bounces", 1.0, 10.0, 1.0).name("Bounces").onChange(v => {
        diamond.material.uniforms.bounces.value = v;
    });
    gui.add(effectController, "ior", 1.0, 5.0, 0.01).name("IOR").onChange(v => {
        diamond.material.uniforms.ior.value = v;
    });
    gui.add(effectController, "correctMips").onChange(v => {
        diamond.material.uniforms.correctMips.value = v;
    });
    stats = new Stats();
    stats.showPanel(0);
    document.body.appendChild(stats.dom);
    render();

}

function render() {
    stats.update();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
}