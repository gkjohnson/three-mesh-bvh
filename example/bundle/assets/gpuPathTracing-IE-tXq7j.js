import{W as F,c as R,D as O,A as E,P as I,S as W,n as x,s as _,M as A,g as D,aa as L,F as T,H as U,a0 as z,f as H}from"./ExtendedTriangle-hsPasuNU.js";import{F as b}from"./Pass-BOKrxmL7.js";import{G as j}from"./GLTFLoader-Be-eETKy.js";import{O as B}from"./OrbitControls-DEZHvbFX.js";import{m as G}from"./BufferGeometryUtils-BuPYlHUL.js";import{S as V}from"./stats.min-DbzWzcqd.js";import{g as N}from"./lil-gui.module.min-BH_YJbPT.js";import{F as k,M as $}from"./MeshBVHUniformStruct-5h9E4Xx4.js";import{M as Q,S as X}from"./MeshBVH-DQV6PBDm.js";import{c as Y,b as q,a as J}from"./bvh_struct_definitions.glsl-kQBCFuAP.js";import"./_commonjsHelpers-CqkleIqs.js";const o={enableRaytracing:!0,smoothImageScaling:!0,resolutionScale:.5/window.devicePixelRatio,bounces:3,accumulate:!0};let e,t,l,i,h,s,P,m,c,d=0,M;K();S();function K(){e=new F({antialias:!1}),e.setPixelRatio(window.devicePixelRatio),e.setClearColor(594970),e.setSize(window.innerWidth,window.innerHeight),e.outputEncoding=void 0,document.body.appendChild(e.domElement),M=document.getElementById("output"),l=new R;const r=new O(16777215,1);r.position.set(1,1,1),l.add(r),l.add(new E(11583173,.5)),t=new I(75,window.innerWidth/window.innerHeight,.1,50),t.position.set(-2,2,3),t.far=100,t.updateProjectionMatrix(),h=new V,document.body.appendChild(h.dom);const a=new W({defines:{BOUNCES:5},uniforms:{bvh:{value:new $},normalAttribute:{value:new k},cameraWorldMatrix:{value:new x},invProjectionMatrix:{value:new x},seed:{value:0},opacity:{value:1}},vertexShader:`

			varying vec2 vUv;
			void main() {

				vec4 mvPosition = vec4( position, 1.0 );
				mvPosition = modelViewMatrix * mvPosition;
				gl_Position = projectionMatrix * mvPosition;

				vUv = uv;

			}

		`,fragmentShader:`
			#define RAY_OFFSET 1e-5

			precision highp isampler2D;
			precision highp usampler2D;
			${Y}
			${q}
			${J}
			#include <common>

			uniform mat4 cameraWorldMatrix;
			uniform mat4 invProjectionMatrix;
			uniform sampler2D normalAttribute;
			uniform BVH bvh;
			uniform float seed;
			uniform float opacity;
			varying vec2 vUv;

			void main() {

				// get [-1, 1] normalized device coordinates
				vec2 ndc = 2.0 * vUv - vec2( 1.0 );
				vec3 rayOrigin, rayDirection;
				ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix, rayOrigin, rayDirection );

				// Lambertian render
				gl_FragColor = vec4( 0.0 );

				vec3 throughputColor = vec3( 1.0 );
				vec3 randomPoint = vec3( .0 );

				// hit results
				uvec4 faceIndices = uvec4( 0u );
				vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
				vec3 barycoord = vec3( 0.0 );
				float side = 1.0;
				float dist = 0.0;

				for ( int i = 0; i < BOUNCES; i ++ ) {

					if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

						float value = ( rayDirection.y + 0.5 ) / 1.5;
						vec3 skyColor = mix( vec3( 1.0 ), vec3( 0.75, 0.85, 1.0 ), value );

						gl_FragColor = vec4( skyColor * throughputColor * 2.0, 1.0 );

						break;

					}

					// 1 / PI attenuation for physically correct lambert model
					// https://www.rorydriscoll.com/2009/01/25/energy-conservation-in-games/
					throughputColor *= 1.0 / PI;

					randomPoint = vec3(
						rand( vUv + float( i + 1 ) + vec2( seed, seed ) ),
						rand( - vUv * seed + float( i ) - seed ),
						rand( - vUv * float( i + 1 ) - vec2( seed, - seed ) )
					);
					randomPoint -= 0.5;
					randomPoint *= 2.0;

					// ensure the random vector is not 0,0,0 and that it won't exactly negate
					// the surface normal

					float pointLength = max( length( randomPoint ), 1e-4 );
					randomPoint /= pointLength;
					randomPoint *= 0.999;

					// fetch the interpolated smooth normal
					vec3 normal =
						side *
						textureSampleBarycoord(
							normalAttribute,
							barycoord,
							faceIndices.xyz
						).xyz;

					// adjust the hit point by the surface normal by a factor of some offset and the
					// maximum component-wise value of the current point to accommodate floating point
					// error as values increase.
					vec3 point = rayOrigin + rayDirection * dist;
					vec3 absPoint = abs( point );
					float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
					rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
					rayDirection = normalize( normal + randomPoint );

				}

				gl_FragColor.a = opacity;

			}

		`});s=new b(a),a.transparent=!0,a.depthWrite=!1,new j().load("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/dragon-attenuation/DragonAttenuation.glb",v=>{let g;v.scene.traverse(f=>{f.isMesh&&f.name==="Dragon"&&(g=f,f.geometry.scale(.25,.25,.25).rotateX(Math.PI/2))});const w=new _(5,5,1,1);w.rotateX(-Math.PI/2);const y=G([w,g.geometry],!1);y.translate(0,-.5,0),c=new A(y,new D),l.add(c);const C=new Q(c.geometry,{maxLeafSize:1,strategy:X});a.uniforms.bvh.value.updateFrom(C),a.uniforms.normalAttribute.value.updateFrom(c.geometry.attributes.normal)});const n=e.extensions.get("OES_texture_float_linear");m=new L(1,1,{format:z,type:n?T:U}),P=new b(new H({map:m.texture})),new B(t,e.domElement).addEventListener("change",()=>{u()}),i=new N,i.add(o,"enableRaytracing").name("enable"),i.add(o,"accumulate"),i.add(o,"smoothImageScaling"),i.add(o,"resolutionScale",.1,1,.01).onChange(p),i.add(o,"bounces",1,10,1).onChange(v=>{a.defines.BOUNCES=parseInt(v),a.needsUpdate=!0,u()}),i.open(),window.addEventListener("resize",p,!1),p()}function u(){d=0}function p(){t.aspect=window.innerWidth/window.innerHeight,t.updateProjectionMatrix();const r=window.innerWidth,a=window.innerHeight,n=window.devicePixelRatio*o.resolutionScale;e.setSize(r,a),e.setPixelRatio(n),m.setSize(r*n,a*n),u()}function S(){if(h.update(),requestAnimationFrame(S),e.domElement.style.imageRendering=o.smoothImageScaling?"auto":"pixelated",c&&o.enableRaytracing){if(o.accumulate)if(d===0)t.clearViewOffset();else{const a=m.width,n=m.height;t.setViewOffset(a,n,Math.random()-.5,Math.random()-.5,a,n)}else u();t.updateMatrixWorld();const r=(s.material.uniforms.seed.value+.11111)%2;s.material.uniforms.seed.value=r,s.material.uniforms.cameraWorldMatrix.value.copy(t.matrixWorld),s.material.uniforms.invProjectionMatrix.value.copy(t.projectionMatrixInverse),s.material.uniforms.opacity.value=1/(d+1),e.autoClear=d===0,e.setRenderTarget(m),s.render(e),e.setRenderTarget(null),P.render(e),e.autoClear=!0,d++}else u(),t.clearViewOffset(),e.render(l,t);M.innerText=`samples: ${d}`}
//# sourceMappingURL=gpuPathTracing-IE-tXq7j.js.map
