import{W as h,c as M,D as x,A as g,P as b,T as y,M as S,g as P,S as H,q as l,h as O}from"./ExtendedTriangle-CFC-kWKu.js";import{O as W}from"./OrbitControls-DPxOa-V_.js";import{F as R}from"./Pass-B2WwlmPI.js";import{S as A}from"./stats.min-GTpOrGrX.js";import{g as C}from"./lil-gui.module.min-jESndyO-.js";import{M as _,S as D}from"./MeshBVH-CE-cOGaL.js";import{M as F,F as j}from"./MeshBVHUniformStruct-BasBaY-w.js";import{c as L,b as N,a as T}from"./bvh_struct_definitions.glsl-SZg5BxSQ.js";import"./_commonjsHelpers-Cpj98o6Y.js";const r={enableRaytracing:!0,animate:!0,resolutionScale:1/window.devicePixelRatio,smoothNormals:!0};let e,i,o,n,u,d,s,f;z();w();function z(){e=new h({antialias:!1}),e.setPixelRatio(window.devicePixelRatio),e.setClearColor(594970),e.setSize(window.innerWidth,window.innerHeight),e.outputEncoding=void 0,document.body.appendChild(e.domElement),o=new M;const a=new x(16777215,1);a.position.set(1,1,1),o.add(a),o.add(new g(11583173,.5)),i=new b(75,window.innerWidth/window.innerHeight,.1,50),i.position.set(0,0,4),i.far=100,i.updateProjectionMatrix(),u=new A,document.body.appendChild(u.dom);const t=new y(1,.3,300,50),c=new _(t,{maxLeafTris:1,strategy:D});s=new S(t,new P),o.add(s),f=new O;const m=new H({defines:{SMOOTH_NORMALS:1},uniforms:{bvh:{value:new F},normalAttribute:{value:new j},cameraWorldMatrix:{value:new l},invProjectionMatrix:{value:new l},invModelMatrix:{value:new l}},vertexShader:`

			varying vec2 vUv;
			void main() {

				vec4 mvPosition = vec4( position, 1.0 );
				mvPosition = modelViewMatrix * mvPosition;
				gl_Position = projectionMatrix * mvPosition;

				vUv = uv;

			}

		`,fragmentShader:`
			precision highp isampler2D;
			precision highp usampler2D;

			${L}
			${N}
			${T}

			uniform mat4 cameraWorldMatrix;
			uniform mat4 invProjectionMatrix;
			uniform mat4 invModelMatrix;
			uniform sampler2D normalAttribute;
			uniform BVH bvh;
			varying vec2 vUv;

			void main() {

				// get [-1, 1] normalized device coordinates
				vec2 ndc = 2.0 * vUv - vec2( 1.0 );
				vec3 rayOrigin, rayDirection;
				ndcToCameraRay(
					ndc, invModelMatrix * cameraWorldMatrix, invProjectionMatrix,
					rayOrigin, rayDirection
				);

				// hit results
				uvec4 faceIndices = uvec4( 0u );
				vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
				vec3 barycoord = vec3( 0.0 );
				float side = 1.0;
				float dist = 0.0;

				// get intersection
				bool didHit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );

				#if SMOOTH_NORMALS

					vec3 normal = textureSampleBarycoord(
						normalAttribute,
						barycoord,
						faceIndices.xyz
					).xyz;

				#else

					vec3 normal = face.normal;

				#endif

				// set the color
				gl_FragColor = ! didHit ? vec4( 0.0366, 0.0813, 0.1057, 1.0 ) : vec4( normal, 1.0 );

			}
		`});d=new R(m),m.uniforms.bvh.value.updateFrom(c),m.uniforms.normalAttribute.value.updateFrom(t.attributes.normal),new W(i,e.domElement),n=new C,n.add(r,"enableRaytracing"),n.add(r,"animate"),n.add(r,"smoothNormals").onChange(p=>{d.material.defines.SMOOTH_NORMALS=Number(p),d.material.needsUpdate=!0}),n.add(r,"resolutionScale",.1,1,.01).onChange(v),n.open(),window.addEventListener("resize",v,!1),v()}function v(){i.aspect=window.innerWidth/window.innerHeight,i.updateProjectionMatrix();const a=window.innerWidth,t=window.innerHeight,c=window.devicePixelRatio*r.resolutionScale;e.setSize(a,t),e.setPixelRatio(c)}function w(){u.update(),requestAnimationFrame(w);const a=f.getDelta();if(r.animate&&(s.rotation.y+=a),r.enableRaytracing){i.updateMatrixWorld(),s.updateMatrixWorld();const t=d.material.uniforms;t.cameraWorldMatrix.value.copy(i.matrixWorld),t.invProjectionMatrix.value.copy(i.projectionMatrixInverse),t.invModelMatrix.value.copy(s.matrixWorld).invert(),d.render(e)}else e.render(o,i)}
