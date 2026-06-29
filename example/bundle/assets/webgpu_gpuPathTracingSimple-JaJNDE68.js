import{Fr as e,H as t,Ht as n,Ut as r,Xt as i,Yr as a,gr as o,mr as s,o as c,on as l,x as u}from"./ExtendedTriangle-DOKLf4jx.js";import{t as d}from"./Pass-WYNZO8G0.js";import{t as f}from"./lil-gui.module.min-CCk8J1jY.js";import{t as p}from"./OrbitControls-BX2ddTIw.js";import{t as m}from"./stats.module-BDErWxYO.js";import{C as h,S as g,_,a as v,d as y,f as b,g as x,h as S,l as C,n as w,r as T,t as E,v as D,y as O}from"./BVHComputeData-BuNvKHpP.js";x(`

	const BVH_STACK_DEPTH = 60u;
	const INFINITY = 1e20;
	const TRI_INTERSECT_EPSILON = 1e-5;

`);var k=x(`
	struct Ray {
		origin: vec3f,
		direction: vec3f,
	};
`),A=x(`
	struct BVHBoundingBox {
		min: array<f32, 3>,
		max: array<f32, 3>,
	}
`);x(`
	struct BVHNode {
		bounds: BVHBoundingBox,
		rightChildOrTriangleOffset: u32,
		splitAxisOrTriangleCount: u32,
	};
`,[A]),x(`
	struct IntersectionResult {
		indices: vec4u,
		normal: vec3f,
		didHit: bool,
		barycoord: vec3f,
		side: f32,
		dist: f32,
	};
`),_(`

	fn getVertexAttribute(
		barycoord: vec3f,
		indices: vec3u,
		attributeBuffer: ptr<storage, array<vec3f>, read>
	) -> vec3f {

		let n0 = attributeBuffer[ indices.x ];
		let n1 = attributeBuffer[ indices.y ];
		let n2 = attributeBuffer[ indices.z ];
		return barycoord.x * n0 + barycoord.y * n1 + barycoord.z * n2;

	}

`);var j=_(`

	fn ndcToCameraRay( ndc: vec2f, inverseModelViewProjection: mat4x4f ) -> Ray {

		// Calculate the ray by picking the points at the near and far plane and deriving the ray
		// direction from the two points. This approach works for both orthographic and perspective
		// camera projection matrices.
		// The returned ray direction is not normalized and extends to the camera far plane.
		var homogeneous = vec4f();
		var ray = Ray();

		homogeneous = inverseModelViewProjection * vec4f( ndc, 0.0, 1.0 );
		ray.origin = homogeneous.xyz / homogeneous.w;

		homogeneous = inverseModelViewProjection * vec4f( ndc, 1.0, 1.0 );
		ray.direction = ( homogeneous.xyz / homogeneous.w ) - ray.origin;

		return ray;

	}
`);_(`

	fn intersectsBounds(
		ray: Ray,
		bounds: BVHBoundingBox,
		dist: ptr<function, f32>
	) -> bool {

		let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
		let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );

		let invDir = 1.0 / ray.direction;
		let tMinPlane = ( boundsMin - ray.origin ) * invDir;
		let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

		let tMinHit = vec3f(
			min( tMinPlane.x, tMaxPlane.x ),
			min( tMinPlane.y, tMaxPlane.y ),
			min( tMinPlane.z, tMaxPlane.z )
		);

		let tMaxHit = vec3f(
			max( tMinPlane.x, tMaxPlane.x ),
			max( tMinPlane.y, tMaxPlane.y ),
			max( tMinPlane.z, tMaxPlane.z )
		);

		let t0 = max( max( tMinHit.x, tMinHit.y ), tMinHit.z );
		let t1 = min( min( tMaxHit.x, tMaxHit.y ), tMaxHit.z );

		( *dist ) = max( t0, 0.0 );

		return t1 >= ( *dist );

	}

`,[k,A]);var M={enableRaytracing:!0,animate:!0,resolutionScale:1/window.devicePixelRatio,smoothNormals:!0},N,P,F,I,L,R,z,B,V,H,U,W,G=[],K=[8,8,1];q();function q(){N=new h({canvas:document.createElement(`canvas`),antialias:!0,forceWebGL:!1}),N.setAnimationLoop(Y),N.setPixelRatio(window.devicePixelRatio),N.setClearColor(594970),N.setSize(window.innerWidth,window.innerHeight),N.outputColorSpace=s,document.body.appendChild(N.domElement),F=new o;let x=new t(16777215,1);x.position.set(1,1,1),F.add(x),F.add(new c(11583173,.5)),P=new l(75,window.innerWidth/window.innerHeight,1,10),P.position.set(0,0,4),P.updateProjectionMatrix(),L=new m,document.body.appendChild(L.dom),z=new r(new e(1,.3,300,50),new i),F.add(z),B=new u,W=new E(z,{attributes:{position:`vec4f`,normal:`vec4f`}}),W.update(),U=new g(1,1),J();let k={outputTex:y(U),smoothNormals:b(1),inverseProjectionMatrix:b(new n),cameraToModelMatrix:b(new n),workgroupSize:b(new a),workgroupId:D,localId:v};H=_(`

		fn compute(
			outputTex: texture_storage_2d<rgba8unorm, write>,
			smoothNormals: u32,
			inverseProjectionMatrix: mat4x4f,
			cameraToModelMatrix: mat4x4f,
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
			var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

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
	`,[j,W.fns.raycastFirstHit,W.fns.sampleTrianglePoint])(k).computeKernel(K);let A=S(`vec2`,`vUv`),G=_(`
		fn vertex( position: vec3f, uv: vec2f ) -> vec3f {
			varyings.vUv = uv;
			return position;
		}
	`,[A]);V=new O,V.positionNode=G({position:w(`position`),uv:w(`uv`)}),V.colorNode=T(C(U,A),s),R=new d(V),new p(P,N.domElement),I=new f,I.add(M,`enableRaytracing`),I.add(M,`animate`),I.add(M,`smoothNormals`),I.add(M,`resolutionScale`,.1,1,.01).onChange(J),I.open(),window.addEventListener(`resize`,J,!1),J()}function J(){let e=window.innerWidth,t=window.innerHeight,n=window.devicePixelRatio,r=M.resolutionScale;P.aspect=e/t,P.updateProjectionMatrix(),N.setSize(e,t),N.setPixelRatio(n),U.setSize(Math.ceil(e*n*r),Math.ceil(t*n*r))}function Y(){L.update();let e=B.getDelta();M.animate&&(z.rotation.y+=e),M.enableRaytracing?(G=[Math.ceil(U.width/K[0]),Math.ceil(U.height/K[1])],P.updateMatrixWorld(),z.updateMatrixWorld(),H.computeNode.parameters.outputTex.value=U,H.computeNode.parameters.smoothNormals.value=Number(M.smoothNormals),H.computeNode.parameters.inverseProjectionMatrix.value=P.projectionMatrixInverse,H.computeNode.parameters.cameraToModelMatrix.value.copy(z.matrixWorld).invert().multiply(P.matrixWorld),H.computeNode.parameters.workgroupSize.value.fromArray(K),N.compute(H,G),V.colorNode.colorNode.value=U,R.render(N)):N.render(F,P)}
//# sourceMappingURL=webgpu_gpuPathTracingSimple-JaJNDE68.js.map