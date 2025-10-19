import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import {
  MeshBVHHelper, MeshBVH,
  computeBoundsTree, disposeBoundsTree,
  SAH,
  BVHShaderGLSL,
  MeshBVHUniformStruct,
  FloatVertexAttributeTexture
} from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {
  open: () => loadSceneFile(),
  size: () => [window.innerWidth, window.innerHeight],

  mode: 'raytracing',
  render: true,
  strategy: SAH,
  maxDepth: 40,
  maxLeafTris: 8,
  maxStdDev: 1.5, // exp2, same as maxStdDev in https://sparkjs.dev
  splatScale: 0, // exp2
  splatOpacity: 0, // exp2, density that absorbs light 

  get bvhOptions() {
    return {
      strategy: params.strategy,
      maxDepth: params.maxDepth,
      maxLeafTris: params.maxLeafTris,
    };
  },
};

let renderer, camera, scene, orbit, gui, stats, outputContainer;
let bvh, bvhGeometry, bvhHelper, pointCloud;
let raytracingPass, canvasDrawPass;
let pixelsRT1, pixelsRT2;
let splatColorsRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
let frameId = 0;

const sceneFile = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/point-cloud-porsche/scene.ply';
//const sceneFile = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb';

class GSplatsDataUniformStruct {
  splatsCount = bvhGeometry.attributes.position.count; // (xyz, radius) x N
  maxStdDev = 2 ** params.maxStdDev;
  splatOpacity = 2 ** params.splatOpacity;
  splatColors = splatColorsRT.texture;
}

THREE.ShaderChunk['yuv_rgb'] = /* glsl */`
  const mat3 YUV_RGB = transpose(mat3(1,1,1,  0,-0.34,1.77, 1.4,-0.72,0));
  const mat3 RGB_YUV = inverse(YUV_RGB); // yuv = rgb * RGB_YUV
`;

THREE.ShaderChunk['gsplats_data'] = /* glsl */`
  struct GSplatsData {
    int splatsCount;
    float maxStdDev;
    float splatOpacity;
    sampler2D splatColors;
  };
`;

THREE.ShaderChunk['unpack_4x16'] = /* glsl */`
  #define pack2(xy) uintBitsToFloat(packHalf2x16(vec2(xy)))
  #define unpack2(f32) unpackHalf2x16(floatBitsToUint(float(f32)))
  // float 0..1 <-> uint 0..65535
  #define PACK_2x16(xy)   uintBitsToFloat(packUnorm2x16(vec2(xy)))
  #define PACK_4x16(v)    vec2(PACK_2x16(v.xy), PACK_2x16(v.zw))
  #define UNPACK_2x16(x)  unpackUnorm2x16(floatBitsToUint(x))
  #define UNPACK_4x16(v)  vec4(UNPACK_2x16(v.x), UNPACK_2x16(v.y))
`;

THREE.ShaderChunk['pack_pixel_data'] = /* glsl */`
  struct PixelData { 
    vec4 color; // .w < 1.0 - the accumulated density
    float zDepth; 
    int cost; 
  };

  vec4 packPixelData(PixelData pd) {
    vec3 yuv = pd.color.rgb * RGB_YUV;
    vec4 pixel;
    pixel.x = yuv.x; // Y' of Y'UV
    pixel.y = pack2(yuv.yz); // UV of Y'UV, as 2 x float16
    pixel.z = pd.zDepth;
    pixel.w = PACK_2x16(vec2(pd.color.w, float(pd.cost) / float(0xFFFF)));
    return pixel;
  }

  PixelData unpackPixelData(vec4 pixel) {
    vec3 yuv;
    yuv.x = pixel.x;
    yuv.yz = unpack2(pixel.y);
    vec2 wc = UNPACK_2x16(pixel.w);
    PixelData pd;
    pd.color = vec4(yuv * YUV_RGB, wc.x);
    pd.zDepth = pixel.z;
    pd.cost = int(wc.y * float(0xFFFF));
    return pd;
  }
`;

THREE.ShaderChunk['gaussian_utils'] = /* glsl */`
  const float SQRT_PI = sqrt(radians(180.));
  const float SQRT_2 = sqrt(2.0);

  float gaussian3d(vec3 r) {
    return exp(-dot(r, r));
  }
  
  // integrate( exp(-x*x))*2/sqrt(PI), 0..x ) = -1..1
  // https://en.wikipedia.org/wiki/Error_function
  float erf(float x) {
    if (abs(x) > 3.5)
        return sign(x);

    return sign(x)*sqrt(1. - exp2(-SQRT_PI*x*x));
  }

  // 2/sqrt(PI) * integrate( exp(-|pos + dir*t|^2), t=0..len )
  // https://en.wikipedia.org/wiki/Gaussian_integral
  float erf3d(vec3 pos, vec3 dir, float len) {
    if (len < 0.01)
      return len*gaussian3d(pos + dir*len*0.5);

    float b = dot(pos, dir);          // -INF..INF
    float h = dot(pos, pos) - b*b;    // 0..INF
    float s = erf(b + len) - erf(b);  // 0..2
    return exp(-h)*s*SQRT_PI*0.5;     // 0..sqrt(PI)
  }
`;

THREE.ShaderChunk['ray_utils'] = /* glsl */`
  vec2 rayBox(vec3 ro, vec3 rd, vec3 aa, vec3 bb) {
    vec3 ird = 1./rd;
    vec3 tbot = ird*(aa - ro);
    vec3 ttop = ird*(bb - ro);
    vec3 tmin = min(ttop, tbot);
    vec3 tmax = max(ttop, tbot);
    vec2 tx = max(tmin.xx, tmin.yz);
    vec2 ty = min(tmax.xx, tmax.yz);
    vec2 tt;
    tt.x = max(tx.x, tx.y);
    tt.y = min(ty.x, ty.y);
    return tt;
  }
`;

// Finds the nearest 8 splats, blends them, then repeats the same at the next frame.
// In practice, it's usually better to use a proper rasterizer: https://sparkjs.dev.
class RaytracingMaterial extends THREE.ShaderMaterial {

  updateDefines(params) {
    this.defines.BVH_STACK_DEPTH = params.maxDepth;
    this.needsUpdate = true;
  }

  constructor() {

    super({

      uniforms: {

        frameId: { value: 0 },
        bvh: { value: new MeshBVHUniformStruct() },
        gsd: { value: null },
        pixelData: { value: null },
        cameraWorldMatrix: { value: new THREE.Matrix4() },
        projectionMatrix: { value: new THREE.Matrix4() },
        modelWorldMatrix: { value: new THREE.Matrix4() },

      },

      vertexShader: /* glsl */`
        out vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position, 1 );
        }
      `,

      fragmentShader: /* glsl */`
        in vec2 vUv;

        ${BVHShaderGLSL.common_functions}
        ${BVHShaderGLSL.bvh_struct_definitions}

        #include <ray_utils>
        #include <gsplats_data>
        #include <common>
        #include <yuv_rgb>
        #include <unpack_4x16>
        #include <pack_pixel_data>
        #include <gaussian_utils>

        uniform BVH bvh;
        uniform GSplatsData gsd;
        uniform sampler2D pixelData;
        uniform mat4 cameraWorldMatrix;
        uniform mat4 projectionMatrix;
        uniform mat4 modelWorldMatrix;
        uniform int frameId;

        ///// BVH traversal ///////////////////////////////////////////////////

        vec3 bvhRayDir;
        vec3 gRayOrigin;
        float gDistScale = 1.0;
        mat4 gSplats; // the closest 8 splats sorted by distance

        void bvhInitSearch() {
          vec4 s = vec4(INFINITY);
          gSplats = mat4(s, s, s, s);
        }

        bool bvhVisitBoundingBox(vec3 boundsMin, vec3 boundsMax) {
          vec2 tt = rayBox( gRayOrigin, bvhRayDir, boundsMin, boundsMax );
          return tt.x < tt.y && tt.x < gSplats[3].z;
        }

        bool bvhVisitSplat(uint splatId) {
          vec4 splat = texelFetch1D( bvh.position, splatId );
          
          if (splat.w < 1e-6)
              return false;
          
          vec3 r = (gRayOrigin - splat.xyz) / splat.w;
          
          float t = dot(r, -bvhRayDir);
          float h = dot(r, r) - t*t;

          // TODO: Multiply sqrt(h) by the distance from the screen.
          // True rendering needs to capture all splats that map
          // to a pixel, not just those that intersect with a ray.
          if (h >= gDistScale || t <= 0. || t*splat.w >= gSplats[3].z)
            return false;          

          vec4 a = gSplats[0]; // a.x <= a.z <= b.x
          vec4 b = gSplats[1]; // b.x <= b.z <= c.x
          vec4 c = gSplats[2]; // c.x <= c.z <= d.x
          vec4 d = gSplats[3]; // d.x <= d.z
          vec2 s = vec2(t*splat.w, splatId);
          
          if (s.x < d.z) d.zw = s.xy;
          if (d.z < d.x) d = d.zwxy;
          if (d.x < c.z) s = c.zw, c.zw = d.xy, d.xy = s; // swap(c.zw, d.xy)
          if (c.z < c.x) c = c.zwxy;
          if (c.x < b.z) s = b.zw, b.zw = c.xy, c.xy = s; // swap(b.zw, c.xy)
          if (b.z < b.x) b = b.zwxy;
          if (b.x < a.z) s = a.zw, a.zw = b.xy, b.xy = s; // swap(a.zw, b.xy)
          if (a.z < a.x) a = a.zwxy;

          gSplats = mat4(a, b, c, d);
          return true;
        }
        
        ${BVHShaderGLSL.bvh_gsplat_ray_functions}

        ///// splat color blending ///////////////////////////////////////////
        
        bool blendSplat(vec2 entry, inout vec4 sumColor) {
          uint splatId = uint(entry.y);
          float dist = entry.x;

          if (dist >= INFINITY || sumColor.w >= 1.0)
            return false;
          
          vec4 splat = texelFetch1D(bvh.position, splatId);
          vec4 color = texelFetch1D(gsd.splatColors, splatId);

          color.w *= gsd.splatOpacity;
          color.w /= gDistScale;

          // rasterizer-style blending: splats are approximated with flat ellipses
          vec3 r = (gRayOrigin + bvhRayDir*dist - splat.xyz) / splat.w;
          color.w *= gaussian3d(r * gsd.maxStdDev / SQRT_2 / gDistScale);

          color.rgb *= color.w;
          sumColor += (1. - sumColor.w) * color;
          return true;
        }
        
        void main() {
          vec2 ndc = vUv*2. - 1.;
          vec3 rayOrigin, rayDirection;
          ndcToCameraRay(
            ndc, inverse(modelWorldMatrix) * cameraWorldMatrix,
            inverse(projectionMatrix),
            rayOrigin, rayDirection);

          vec2 size = vec2(textureSize(pixelData, 0));
          vec4 pixel = texelFetch(pixelData, ivec2(vUv*size), 0);
          PixelData pd = unpackPixelData(pixel);

          if (frameId > 0 && pd.zDepth >= INFINITY) {
            gl_FragColor = pixel;
            return;
          }

          if (frameId == 0) {
            pd.color = vec4(0);
            pd.zDepth = 0.;
            pd.cost = 0;
          }
          
          bvhRayDir = normalize(rayDirection);
          gRayOrigin = rayOrigin + pd.zDepth * bvhRayDir;
          //gDistScale = 1.0 + pd.zDepth/length(rayOrigin);
          bvhSearchSplats( bvh );
          pd.cost += bvhTexLookups; // total cost
          vec4 rgba = pd.color;

          blendSplat(gSplats[0].xy, rgba) &&
          blendSplat(gSplats[0].zw, rgba) &&
          blendSplat(gSplats[1].xy, rgba) &&
          blendSplat(gSplats[1].zw, rgba) &&
          blendSplat(gSplats[2].xy, rgba) &&
          blendSplat(gSplats[2].zw, rgba) &&
          blendSplat(gSplats[3].xy, rgba) &&
          blendSplat(gSplats[3].zw, rgba);
          
          pd.color = rgba;
          // add some margin to make sure the next run skips this splat
          pd.zDepth += (1. + 1e-6) * gSplats[3].z + 1e-6;
          gl_FragColor = packPixelData(pd);
        }`
    });
  }
}

class CanvasDrawMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        monochrome: { value: false },
        pixelData: { value: null },
        frameId: { value: 0 },
        gsd: { value: null },
      },

      vertexShader: /* glsl */`
        out vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position, 1.0 );
        }
      `,

      fragmentShader: /* glsl */`
        in vec2 vUv;

        uniform sampler2D pixelData;
        uniform int frameId;
        uniform bool monochrome;

        #include <yuv_rgb>
        #include <unpack_4x16>
        #include <gsplats_data>
        #include <pack_pixel_data>

        ${BVHShaderGLSL.common_functions}

        uniform GSplatsData gsd;
        vec2 size;
        const int M = 5;

        void drawProgress(inout vec4 o) {
          vec2 uv = vUv*float(M);
          if (uv != clamp(uv, 0., 1.))
            return;

          vec4 pixel = texelFetch(pixelData, ivec2(uv*size), 0);
          PixelData pd = unpackPixelData(pixel);

          if (pd.zDepth < INFINITY) {
            float weight = 8.0*pd.color.w;
            o.rgb = vec3(3,1,9) * exp(-weight);
          }
        }

        void drawCost(inout vec4 o) {
          vec2 uv = vUv*float(M) - vec2(M-1,0);
          if (uv != clamp(uv, 0., 1.))
            return;

          vec4 pixel = texture(pixelData, uv);
          PixelData pd = unpackPixelData(pixel);
          o.rgb = vec3(9,3,1) * float(pd.cost)/float(0x10000);
        }

        void main() {
          size = vec2(textureSize(pixelData, 0));
          vec4 pixel = texelFetch(pixelData, ivec2(vUv*size), 0);
          PixelData pd = unpackPixelData(pixel);
          vec4 o = pd.color;

          //o.rgb += exp(-o.w) * backgroundRGB;

          drawProgress(o);
          drawCost(o);

          if (isnan(dot(o, vec4(1))))
            o = vec4(0,1,0,1);

          gl_FragColor = vec4(o.rgb, 1);
        }`
    });
  }
}

// (f_dc, rgb, opacity) -> rgba = 0..1
class SplatColorsMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        ply: { value: null },
      },

      vertexShader: /* glsl */`
        out vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position, 1.0 );
        }
      `,

      fragmentShader: /* glsl */`
        in vec2 vUv;

        uniform struct { sampler2D f_dc, rgb, opacity; } ply;

        #include <common>

        void main() {
          vec2 size = vec2(textureSize(ply.f_dc, 0));

          vec3 rgb = texelFetch(ply.rgb, ivec2(vUv*size), 0).rgb;
          vec3 f_dc = texelFetch(ply.f_dc, ivec2(vUv*size), 0).rgb;
          float opacity = texelFetch(ply.opacity, ivec2(vUv*size), 0).x;

          gl_FragColor = vec4(1);

          if (!isnan(rgb.x)) gl_FragColor.rgb = rgb/255.;
          if (!isnan(f_dc.x)) gl_FragColor.rgb = f_dc/sqrt(PI)*0.5 + 0.5;
          if (!isnan(opacity)) gl_FragColor.a = 1./(1. + exp(-opacity));
        }`
    });
  }
}

async function init() {
  outputContainer = document.getElementById('output');

  let [w, h] = params.size();
  console.log('Canvas size:', w, 'x', h);

  renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0, 0);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  let light = new THREE.DirectionalLight(0xFFFFFF);
  light.position.set(new THREE.Vector3(1e3, 2e3, 3e3));
  scene.add(light);

  camera = new THREE.PerspectiveCamera(60, w / h, 0.001, 50);
  camera.position.set(4, 3, 5);
  camera.far = 100;
  camera.updateProjectionMatrix();

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.addEventListener('change', () => clearRenderTargets());
  orbit.addEventListener('start', () => { orbit.interacting = true; });
  orbit.addEventListener('end', () => { orbit.interacting = false; });

  pixelsRT1 = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
  pixelsRT2 = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });

  stats = new Stats();
  document.body.appendChild(stats.dom);

  canvasDrawPass = new FullScreenQuad(new CanvasDrawMaterial());
  raytracingPass = new FullScreenQuad(new RaytracingMaterial());
  raytracingPass.material.updateDefines(params);

  window.params = params;
  window.THREE = THREE;
  window.renderer = renderer;

  initGeometry();
  rebuildGUI();

  updateRenderSize();
  window.addEventListener('resize',
    () => updateRenderSize(), false);
}

function updateRenderSize() {
  let [w, h] = params.size();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h, false);
  clearRenderTargets();
}

function clearRenderTargets() {
  let [w, h] = params.size();
  pixelsRT1.setSize(w, h);
  pixelsRT2.setSize(w, h);
  frameId = 0;
}

async function loadSceneFile() {
  let input = document.createElement('input');
  input.type = 'file';
  input.accept = '*.ply';
  input.multiple = false;
  input.click();
  let blob = await new Promise(resolve =>
    input.onchange = () => resolve(input.files[0]));
  if (!blob) return;

  frameId = -1;

  console.log('Opening file:', (blob.size / 1e6).toFixed(1), 'MB', blob.name);
  let url = URL.createObjectURL(blob);
  await initGeometry(url, blob.name);
  URL.revokeObjectURL(url);

  clearRenderTargets();
}

async function loadGeometry(url, filename = url) {
  console.time('loadGeometry');
  console.log('Loading scene:', filename);

  let geometry = filename.endsWith('.ply') ?
    await loadPLY(url) :
    await loadGLTF(url);

  geometry.center();
  console.timeEnd('loadGeometry');
  return geometry;
}

async function loadPLY(url) {
  let ply = new PLYLoader();

  // these will go to geometry.attributes
  ply.setCustomPropertyNameMapping({
    scale: ['scale_0', 'scale_1', 'scale_2'], // scale = log(S)
    f_dc: ['f_dc_0', 'f_dc_1', 'f_dc_2'], // f_dc = (RGB - 0.5)*sqrt(PI)*2.0
    rgb: ['red', 'green', 'blue'], // 0..255
    opacity: ['opacity'], // opacity = -log(1.0/A - 1.0), A=0..1
    // rot: ['rot_0', 'rot_1', 'rot_2', 'rot_3'], // quaternion rotation
  });

  return await ply.loadAsync(url);
}

async function loadGLTF(url) {
  let gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let gltfMesh = gltf.scene.children[0];
  return gltfMesh.geometry;
}

async function initGeometry(url = sceneFile, filename) {
  outputContainer.textContent = 'Loading ' + url + '...';

  const geometry = await loadGeometry(url, filename);
  const material = new THREE.PointsMaterial({ color: 0xCCCCCC });
  scene.remove(pointCloud);
  pointCloud = new THREE.Points(geometry, material);
  scene.add(pointCloud);

  pointCloud.matrixAutoUpdate = false;
  pointCloud.updateMatrixWorld();

  updateBVHMesh(); // no need to wait
  updateSplatColors();
}

async function sleep(msec) {
  return new Promise(resolve => setTimeout(resolve, msec));
}

async function updateBVHMesh() {
  outputContainer.textContent = 'Updating BVH...';
  await sleep(0);
  frameId = -1;

  bvhGeometry = new THREE.BufferGeometry();
  let attributes = pointCloud.geometry.attributes;

  let m = 1;
  let position = attributes.position;
  let numSplats = position.count;
  let numSplatsM = numSplats / m | 0;

  if (numSplatsM > 1e5) console.time('updateBVH');

  let position3 = new THREE.BufferAttribute(new Float32Array(numSplats * 9), 3); // [xyz, xyz - r, xyz + r]
  let position4 = new THREE.BufferAttribute(new Float32Array(numSplats * 4), 4); // (xyz, radius)
  let baseScale = 2 ** (params.maxStdDev + params.splatScale);
  let defaultScale = attributes.scale && Number.isFinite(attributes.scale.array[0]) ? 0 : 0.0025;

  for (let i = 0; i < numSplats; i++) {
    let x = position.array[i * m * 3 + 0];
    let y = position.array[i * m * 3 + 1];
    let z = position.array[i * m * 3 + 2];
    let r = baseScale * (defaultScale || Math.exp(attributes.scale.array[i * m * 3]));

    // this is for GLSL shaders

    position4.array[i * 4 + 0] = x;
    position4.array[i * 4 + 1] = y;
    position4.array[i * 4 + 2] = z;
    position4.array[i * 4 + 3] = r;

    // this is for MeshBVH

    position3.array[i * 9 + 0] = x;
    position3.array[i * 9 + 1] = y;
    position3.array[i * 9 + 2] = z;

    position3.array[i * 9 + 3] = x - r;
    position3.array[i * 9 + 4] = y - r;
    position3.array[i * 9 + 5] = z - r;

    position3.array[i * 9 + 6] = x + r;
    position3.array[i * 9 + 7] = y + r;
    position3.array[i * 9 + 8] = z + r;
  }

  //console.log('max(position3)', position3.array.reduce((s, x) => Math.max(s, Math.abs(x)), 0));
  //console.log('max(position4)', position4.array.reduce((s, x) => Math.max(s, Math.abs(x)), 0));

  let index = [];

  for (let i = 0; i < numSplatsM; i++) {
    let j = i * m * 3;
    index.push(j + 0, j + 1, j + 2);
  }

  bvhGeometry.setIndex(index);
  bvhGeometry.setAttribute('position', position3);
  bvhGeometry.computeBoundsTree(params.bvhOptions);

  // BVH must be aligned with sunrays for best performance
  let bvhHelperMesh = new THREE.Mesh(bvhGeometry, new THREE.MeshBasicMaterial());
  bvhHelperMesh.matrix = pointCloud.matrix.clone();
  bvhHelperMesh.matrixAutoUpdate = false;

  scene.remove(bvhHelper);
  bvhHelper = new MeshBVHHelper(bvhHelperMesh, params.depth);
  scene.add(bvhHelper);
  bvhHelper.displayParents = true;
  bvhHelper.opacity = 0.1;
  bvhHelper.update();

  // GLSL needs 4-element position attr for efficiency, but MeshBVH doesn't support that,
  // so build the BVH first, and then replace the position attr, as MeshBVH no longer needs it.
  bvh = new MeshBVH(bvhGeometry, params.bvhOptions);
  bvhGeometry.attributes.position.copy(position4);
  position3 = null; // it's been replaced with position4

  let bbox = new THREE.Box3();
  bvh.getBoundingBox(bbox);
  let dx = bbox.max.x - bbox.min.x;
  let dy = bbox.max.y - bbox.min.y;
  let dz = bbox.max.z - bbox.min.z;
  console.debug('Bounding box:', dx.toFixed(2), 'x', dy.toFixed(2), 'x', dz.toFixed(2));

  if (numSplatsM > 1e5) console.timeEnd('updateBVH');

  let str = numSplatsM < 1e3 ? numSplatsM :
    numSplatsM < 1e6 ? (numSplatsM / 1e3).toFixed(0) + 'K' :
      (numSplatsM / 1e6).toFixed(1) + 'M';
  outputContainer.textContent = str + ' splats';
  clearRenderTargets();
}

function rebuildGUI() {
  gui?.destroy();
  gui = new GUI();
  gui.onChange((e) => {
    if (e.property != 'render')
      clearRenderTargets();
  });

  gui.add(params, 'open');

  gui.add(params, 'render').onChange(() => {
    orbit.enabled = params.render;
  });

  const bvhFolder = gui.addFolder('BVH');

  bvhFolder.add(params, 'maxDepth', 4, 64, 1).onChange(v => {
    updateBVHMesh();
  });
  bvhFolder.open();

  const renderFolder = gui.addFolder('Render');
  renderFolder.add(params, 'mode', ['points', 'raytracing']).onChange(v => {
    rebuildGUI();
  });

  if (params.mode == 'raytracing') {
    renderFolder.add(params, 'maxStdDev', 0, 3, 0.5).onChange(() => {
      updateBVHMesh();
    });
    renderFolder.add(params, 'splatScale', -4, 4, 0.5).onChange(() => {
      updateBVHMesh();
    });
    renderFolder.add(params, 'splatOpacity', -4, 8, 0.5);
  }
}

function updateSplatColors() {
  // this is computed only once when the splats file is loaded
  let attributes = pointCloud.geometry.attributes;
  let numSplats = attributes.position.count;

  let rgb = new FloatVertexAttributeTexture();
  let f_dc = new FloatVertexAttributeTexture();
  let opacity = new FloatVertexAttributeTexture();

  let attrNAN = new THREE.BufferAttribute(new Float32Array(numSplats), 1);
  attrNAN.array.fill(Number.NaN);

  rgb.updateFrom(attributes.rgb || attrNAN); // 0..255, uint8
  f_dc.updateFrom(attributes.f_dc || attrNAN);
  opacity.updateFrom(attributes.opacity || attrNAN);

  let { width, height } = opacity.image;
  splatColorsRT.setSize(width, height);

  let shader = new FullScreenQuad(new SplatColorsMaterial());
  shader.material.uniforms.ply.value = { f_dc, rgb, opacity };
  renderer.setRenderTarget(splatColorsRT);
  shader.render(renderer);

  f_dc.dispose();
  opacity.dispose();
}

function render() {

  requestAnimationFrame(render);

  if (frameId < 0 || !params.render)
    return;

  stats.update();

  if (params.mode === 'points' || orbit.interacting) {
    if (!pointCloud) return;

    pointCloud.material.size = 0.005;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);

  } else if (params.mode === 'raytracing') {
    if (!bvh) return; // not ready

    camera.updateMatrixWorld();
    pointCloud.updateMatrixWorld();

    let uniforms;
    let gsd = new GSplatsDataUniformStruct();

    if (params.mode == 'raytracing') {
      uniforms = raytracingPass.material.uniforms;
      uniforms.bvh.value.updateFrom(bvh);
      uniforms.frameId.value = frameId;
      uniforms.cameraWorldMatrix.value.copy(camera.matrixWorld);
      uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
      uniforms.modelWorldMatrix.value.copy(pointCloud.matrixWorld);
      uniforms.pixelData.value = pixelsRT1.texture;
      uniforms.gsd.value = gsd;
      renderer.setRenderTarget(pixelsRT2);
      raytracingPass.render(renderer);
    }

    uniforms = canvasDrawPass.material.uniforms;
    uniforms.frameId.value = frameId;
    uniforms.pixelData.value = pixelsRT2.texture;
    uniforms.gsd.value = gsd;
    renderer.setRenderTarget(null);
    canvasDrawPass.render(renderer);

    [pixelsRT1, pixelsRT2] = [pixelsRT2, pixelsRT1];
    frameId++;
  }
}

init();
render();
