import{W as h,c as M,D as x,A as g,P as b,T as y,M as S,g as P,S as H,n as l,h as O}from"./ExtendedTriangle-hsPasuNU.js";import{O as W}from"./OrbitControls-DEZHvbFX.js";import{F as R}from"./Pass-BOKrxmL7.js";import{S as A}from"./stats.min-DbzWzcqd.js";import{g as C}from"./lil-gui.module.min-BH_YJbPT.js";import{M as _,S as D}from"./MeshBVH-DQV6PBDm.js";import{c as F,b as j,a as z}from"./bvh_struct_definitions.glsl-kQBCFuAP.js";import{F as L,M as N}from"./MeshBVHUniformStruct-5h9E4Xx4.js";import"./_commonjsHelpers-CqkleIqs.js";const a={enableRaytracing:!0,animate:!0,resolutionScale:1/window.devicePixelRatio,smoothNormals:!0};let e,i,o,n,u,d,s,f;T();w();function T(){e=new h({antialias:!1}),e.setPixelRatio(window.devicePixelRatio),e.setClearColor(594970),e.setSize(window.innerWidth,window.innerHeight),e.outputEncoding=void 0,document.body.appendChild(e.domElement),o=new M;const r=new x(16777215,1);r.position.set(1,1,1),o.add(r),o.add(new g(11583173,.5)),i=new b(75,window.innerWidth/window.innerHeight,.1,50),i.position.set(0,0,4),i.far=100,i.updateProjectionMatrix(),u=new A,document.body.appendChild(u.dom);const t=new y(1,.3,300,50),c=new _(t,{maxLeafSize:1,strategy:D});s=new S(t,new P),o.add(s),f=new O;const m=new H({defines:{SMOOTH_NORMALS:1},uniforms:{bvh:{value:new N},normalAttribute:{value:new L},cameraWorldMatrix:{value:new l},invProjectionMatrix:{value:new l},invModelMatrix:{value:new l}},vertexShader:`

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

			${F}
			${j}
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
		`});d=new R(m),m.uniforms.bvh.value.updateFrom(c),m.uniforms.normalAttribute.value.updateFrom(t.attributes.normal),new W(i,e.domElement),n=new C,n.add(a,"enableRaytracing"),n.add(a,"animate"),n.add(a,"smoothNormals").onChange(p=>{d.material.defines.SMOOTH_NORMALS=Number(p),d.material.needsUpdate=!0}),n.add(a,"resolutionScale",.1,1,.01).onChange(v),n.open(),window.addEventListener("resize",v,!1),v()}function v(){i.aspect=window.innerWidth/window.innerHeight,i.updateProjectionMatrix();const r=window.innerWidth,t=window.innerHeight,c=window.devicePixelRatio*a.resolutionScale;e.setSize(r,t),e.setPixelRatio(c)}function w(){u.update(),requestAnimationFrame(w);const r=f.getDelta();if(a.animate&&(s.rotation.y+=r),a.enableRaytracing){i.updateMatrixWorld(),s.updateMatrixWorld();const t=d.material.uniforms;t.cameraWorldMatrix.value.copy(i.matrixWorld),t.invProjectionMatrix.value.copy(i.projectionMatrixInverse),t.invModelMatrix.value.copy(s.matrixWorld).invert(),d.render(e)}else e.render(o,i)}
//# sourceMappingURL=gpuPathTracingSimple-CC5uhGIe.js.map
