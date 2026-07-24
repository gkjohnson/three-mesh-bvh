import{Fr as e,H as t,Ht as n,Ut as r,Xt as i,Yr as a,gr as o,mr as s,o as c,on as l,x as u}from"./ExtendedTriangle-DOKLf4jx.js";import{t as d}from"./Pass-WYNZO8G0.js";import{t as f}from"./lil-gui.module.min-CCk8J1jY.js";import{t as p}from"./OrbitControls-BX2ddTIw.js";import{t as m}from"./stats.module-BDErWxYO.js";import{C as h,S as g,_,f as v,g as y,i as b,n as x,o as S,p as C,r as w,t as T,u as E,v as D,y as O}from"./BVHComputeData-BmCxIjcA.js";var k={enableRaytracing:!0,animate:!0,resolutionScale:1/window.devicePixelRatio,smoothNormals:!0},A,j,M,N,P,F,I,L,R,z,B,V,H=[],U=[8,8,1];W();function W(){A=new h({canvas:document.createElement(`canvas`),antialias:!0,forceWebGL:!1}),A.setAnimationLoop(K),A.setPixelRatio(window.devicePixelRatio),A.setClearColor(594970),A.setSize(window.innerWidth,window.innerHeight),A.outputColorSpace=s,document.body.appendChild(A.domElement),M=new o;let H=new t(16777215,1);H.position.set(1,1,1),M.add(H),M.add(new c(11583173,.5)),j=new l(75,window.innerWidth/window.innerHeight,1,10),j.position.set(0,0,4),j.updateProjectionMatrix(),P=new m,document.body.appendChild(P.dom),I=new r(new e(1,.3,300,50),new i),M.add(I),L=new u,V=new T(I,{attributes:{position:`vec4f`,normal:`vec4f`}}),V.update(),B=new g(1,1),G();let W={outputTex:v(B),smoothNormals:C(1),inverseProjectionMatrix:C(new n),cameraToWorldMatrix:C(new n),workgroupSize:C(new a),workgroupId:D,localId:S};z=_(`

		fn compute(
			outputTex: texture_storage_2d<rgba8unorm, write>,
			smoothNormals: u32,
			inverseProjectionMatrix: mat4x4f,
			cameraToWorldMatrix: mat4x4f,
			workgroupSize: vec3u,
			workgroupId: vec3u,
			localId: vec3u,
		) -> void {

			// to screen coordinates
			let dimensions = textureDimensions( outputTex );
			let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;
			let uv = vec2f( indexUV ) / vec2f( dimensions );
			let ndc = uv * 2.0 - vec2f( 1.0 );

			// scene ray (world space)
			var ray = ndcToCameraRay( ndc, cameraToWorldMatrix * inverseProjectionMatrix );

			// get hit result
			var hit: IntersectionResult;
			bvh_RaycastFirstHit( ray, &hit );

			// write result
			if ( hit.didHit && hit.dist < 1.0 ) {

				let localNormal = normalize( bvh_sampleTrianglePoint( hit.barycoord, hit.indices.xyz ).normal.xyz );
				let normal = select(
					hit.normal,
					localNormal,
					smoothNormals > 0u,
				);
				textureStore( outputTex, indexUV, vec4f( normal, 1.0 ) );

			} else {

				let background = vec4f( 0.0366, 0.0813, 0.1057, 1.0 );
				textureStore( outputTex, indexUV, background );

			}

		}
	`,[x,V.fns.raycastFirstHit,V.fns.sampleTrianglePoint])(W).computeKernel(U);let q=y(`vec2`,`vUv`),J=_(`
		fn vertex( position: vec3f, uv: vec2f ) -> vec3f {
			varyings.vUv = uv;
			return position;
		}
	`,[q]);R=new O,R.positionNode=J({position:w(`position`),uv:w(`uv`)}),R.colorNode=b(E(B,q),s),F=new d(R),new p(j,A.domElement),N=new f,N.add(k,`enableRaytracing`),N.add(k,`animate`),N.add(k,`smoothNormals`),N.add(k,`resolutionScale`,.1,1,.01).onChange(G),N.open(),window.addEventListener(`resize`,G,!1),G()}function G(){let e=window.innerWidth,t=window.innerHeight,n=window.devicePixelRatio,r=k.resolutionScale;j.aspect=e/t,j.updateProjectionMatrix(),A.setSize(e,t),A.setPixelRatio(n),B.setSize(Math.ceil(e*n*r),Math.ceil(t*n*r))}function K(){P.update();let e=L.getDelta();k.animate&&(I.rotation.y+=e,V.updateTransforms()),k.enableRaytracing?(H=[Math.ceil(B.width/U[0]),Math.ceil(B.height/U[1])],j.updateMatrixWorld(),I.updateMatrixWorld(),z.computeNode.parameters.outputTex.value=B,z.computeNode.parameters.smoothNormals.value=Number(k.smoothNormals),z.computeNode.parameters.inverseProjectionMatrix.value=j.projectionMatrixInverse,z.computeNode.parameters.cameraToWorldMatrix.value.copy(j.matrixWorld),z.computeNode.parameters.workgroupSize.value.fromArray(U),A.compute(z,H),R.colorNode.colorNode.value=B,F.render(A)):A.render(M,j)}
//# sourceMappingURL=webgpu_gpuPathTracingSimple-DbmJTk0W.js.map