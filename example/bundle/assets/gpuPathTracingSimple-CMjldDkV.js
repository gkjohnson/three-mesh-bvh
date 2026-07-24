import{n as e}from"./chunk-Bh1tDfsg.js";import{Fr as t,H as n,Ht as r,Ut as i,Xt as a,_r as o,gr as s,i as c,o as l,on as u,x as d}from"./ExtendedTriangle-DOKLf4jx.js";import{t as f}from"./Pass-WYNZO8G0.js";import{t as p}from"./MeshBVH-C4U8FvwO.js";import{n as m,t as h}from"./MeshBVHUniformStruct-BCaighWg.js";import{n as g,r as _,t as v}from"./bvh_struct_definitions.glsl-D-uzwxra.js";import{t as y}from"./stats.min-CnMmk804.js";import{t as b}from"./lil-gui.module.min-CCk8J1jY.js";import{t as x}from"./OrbitControls-BX2ddTIw.js";var S=e(y(),1),C={enableRaytracing:!0,animate:!0,resolutionScale:1/window.devicePixelRatio,smoothNormals:!0},w,T,E,D,O,k,A,j;M(),P();function M(){w=new c({antialias:!1}),w.setPixelRatio(window.devicePixelRatio),w.setClearColor(594970),w.setSize(window.innerWidth,window.innerHeight),w.outputEncoding=void 0,document.body.appendChild(w.domElement),E=new s;let e=new n(16777215,1);e.position.set(1,1,1),E.add(e),E.add(new l(11583173,.5)),T=new u(75,window.innerWidth/window.innerHeight,.1,50),T.position.set(0,0,4),T.far=100,T.updateProjectionMatrix(),O=new S.default,document.body.appendChild(O.dom);let y=new t(1,.3,300,50),M=new p(y,{targetLeafSize:1,strategy:2});A=new i(y,new a),E.add(A),j=new d;let P=new o({defines:{SMOOTH_NORMALS:1},uniforms:{bvh:{value:new h},normalAttribute:{value:new m},cameraWorldMatrix:{value:new r},invProjectionMatrix:{value:new r},invModelMatrix:{value:new r}},vertexShader:`

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

			${_}
			${v}
			${g}

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
		`});k=new f(P),P.uniforms.bvh.value.updateFrom(M),P.uniforms.normalAttribute.value.updateFrom(y.attributes.normal),new x(T,w.domElement),D=new b,D.add(C,`enableRaytracing`),D.add(C,`animate`),D.add(C,`smoothNormals`).onChange(e=>{k.material.defines.SMOOTH_NORMALS=Number(e),k.material.needsUpdate=!0}),D.add(C,`resolutionScale`,.1,1,.01).onChange(N),D.open(),window.addEventListener(`resize`,N,!1),N()}function N(){T.aspect=window.innerWidth/window.innerHeight,T.updateProjectionMatrix();let e=window.innerWidth,t=window.innerHeight,n=window.devicePixelRatio*C.resolutionScale;w.setSize(e,t),w.setPixelRatio(n)}function P(){O.update(),requestAnimationFrame(P);let e=j.getDelta();if(C.animate&&(A.rotation.y+=e),C.enableRaytracing){T.updateMatrixWorld(),A.updateMatrixWorld();let e=k.material.uniforms;e.cameraWorldMatrix.value.copy(T.matrixWorld),e.invProjectionMatrix.value.copy(T.projectionMatrixInverse),e.invModelMatrix.value.copy(A.matrixWorld).invert(),k.render(w)}else w.render(E,T)}
//# sourceMappingURL=gpuPathTracingSimple-CMjldDkV.js.map