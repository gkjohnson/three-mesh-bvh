import{W as h,s as M,S as x,D as g,A as b,P as y,T as S,M as P,d as H,a1 as O,f as m,e as R}from"./ExtendedTriangle-CdCvQVSB.js";import{O as W}from"./OrbitControls-iAm09Il8.js";import{F as A}from"./Pass-BfbAPnNm.js";import{S as C}from"./stats.min-GTpOrGrX.js";import{g as _}from"./lil-gui.module.min-Bc0DeA9g.js";import{M as D,S as F}from"./MeshBVH-BATg3dsp.js";import{M as j,F as L,c as N,b as T,a as z}from"./bvh_struct_definitions.glsl-BvlVbMg-.js";import"./_commonjsHelpers-Cpj98o6Y.js";const a={enableRaytracing:!0,animate:!0,resolutionScale:1/window.devicePixelRatio,smoothNormals:!0};let e,i,o,n,u,s,d,f;U();w();function U(){e=new h({antialias:!1}),e.setPixelRatio(window.devicePixelRatio),e.setClearColor(594970),e.setSize(window.innerWidth,window.innerHeight),e.outputEncoding=M,document.body.appendChild(e.domElement),o=new x;const r=new g(16777215,1);r.position.set(1,1,1),o.add(r),o.add(new b(11583173,.5)),i=new y(75,window.innerWidth/window.innerHeight,.1,50),i.position.set(0,0,4),i.far=100,i.updateProjectionMatrix(),u=new C,document.body.appendChild(u.dom);const t=new S(1,.3,300,50),c=new D(t,{maxLeafTris:1,strategy:F});d=new P(t,new H),o.add(d),f=new R;const l=new O({defines:{SMOOTH_NORMALS:1},uniforms:{bvh:{value:new j},normalAttribute:{value:new L},cameraWorldMatrix:{value:new m},invProjectionMatrix:{value:new m},invModelMatrix:{value:new m}},vertexShader:`

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

			${N}
			${T}
			${z}

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
		`});s=new A(l),l.uniforms.bvh.value.updateFrom(c),l.uniforms.normalAttribute.value.updateFrom(t.attributes.normal),new W(i,e.domElement),n=new _,n.add(a,"enableRaytracing"),n.add(a,"animate"),n.add(a,"smoothNormals").onChange(p=>{s.material.defines.SMOOTH_NORMALS=Number(p),s.material.needsUpdate=!0}),n.add(a,"resolutionScale",.1,1,.01).onChange(v),n.open(),window.addEventListener("resize",v,!1),v()}function v(){i.aspect=window.innerWidth/window.innerHeight,i.updateProjectionMatrix();const r=window.innerWidth,t=window.innerHeight,c=window.devicePixelRatio*a.resolutionScale;e.setSize(r,t),e.setPixelRatio(c)}function w(){u.update(),requestAnimationFrame(w);const r=f.getDelta();if(a.animate&&(d.rotation.y+=r),a.enableRaytracing){i.updateMatrixWorld(),d.updateMatrixWorld();const t=s.material.uniforms;t.cameraWorldMatrix.value.copy(i.matrixWorld),t.invProjectionMatrix.value.copy(i.projectionMatrixInverse),t.invModelMatrix.value.copy(d.matrixWorld).invert(),s.render(e)}else e.render(o,i)}
