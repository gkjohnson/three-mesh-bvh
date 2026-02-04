import{aw as _,c as k,D as V,A as z,P as L,T as B,M as D,g as F,V as W,n as H,a0 as U,aV as j,L as G,h as K}from"./ExtendedTriangle-hsPasuNU.js";import{w as p,i as Q,r as y,b as Y,a as w,c as R,W as Z,S as f,u as v,s as g,t as q,n as J,g as X,l as $,d as ee,v as te,M as oe,e as M,f as re,h as ie,j as ae}from"./common_functions.wgsl-on0d7Tki.js";import{O as se}from"./OrbitControls-DEZHvbFX.js";import{F as ne}from"./Pass-BOKrxmL7.js";import{S as de}from"./stats.module--VATS4Kh.js";import{g as le}from"./lil-gui.module.min-BH_YJbPT.js";import{M as ce,S as ue}from"./MeshBVH-DQV6PBDm.js";const me=p(`

	fn intersectsTriangle( ray: Ray, a: vec3f, b: vec3f, c: vec3f ) -> IntersectionResult {

		var result: IntersectionResult;
		result.didHit = false;

		let edge1 = b - a;
		let edge2 = c - a;
		let n = cross( edge1, edge2 );

		let det = - dot( ray.direction, n );

		if ( abs( det ) < TRI_INTERSECT_EPSILON ) {

			return result;

		}

		let invdet = 1.0 / det;

		let AO = ray.origin - a;
		let DAO = cross( AO, ray.direction );

		let u = dot( edge2, DAO ) * invdet;
		let v = -dot( edge1, DAO ) * invdet;
		let t = dot( AO, n ) * invdet;

		let w = 1.0 - u - v;

		if ( u < - TRI_INTERSECT_EPSILON || v < - TRI_INTERSECT_EPSILON || w < - TRI_INTERSECT_EPSILON || t < TRI_INTERSECT_EPSILON ) {

			return result;

		}

		result.didHit = true;
		result.barycoord = vec3f( w, u, v );
		result.dist = t;
		result.side = sign( det );
		result.normal = result.side * normalize( n );

		return result;

	}

`,[y,w,R]),pe=p(`

	fn intersectTriangles(
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh_index: ptr<storage, array<vec3u>, read>,
		offset: u32,
		count: u32,
		ray: Ray
	) -> IntersectionResult {

		var closestResult: IntersectionResult;

		closestResult.didHit = false;
		closestResult.dist = INFINITY;

		for ( var i = offset; i < offset + count; i = i + 1u ) {

			let indices = bvh_index[ i ];
			let a = bvh_position[ indices.x ];
			let b = bvh_position[ indices.y ];
			let c = bvh_position[ indices.z ];

			var triResult = intersectsTriangle( ray, a, b, c );

			if ( triResult.didHit && triResult.dist < closestResult.dist ) {

				closestResult = triResult;
				closestResult.indices = vec4u( indices.xyz, i );

			}

		}

		return closestResult;

	}

`,[me,y,w,R]),fe=p(`

	fn bvhIntersectFirstHit(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>,read>,
		ray: Ray,
	) -> IntersectionResult {

		var pointer = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = 0u;

		var bestHit: IntersectionResult;

		bestHit.didHit = false;
		bestHit.dist = INFINITY;

		loop {

			if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ pointer ];
			let node = bvh[ currNodeIndex ];

			pointer = pointer - 1;

			var boundsHitDistance: f32 = 0.0;

			if ( ! intersectsBounds( ray, node.bounds, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {

				continue;

			}

			let boundsInfox = node.splitAxisOrTriangleCount;
			let boundsInfoy = node.rightChildOrTriangleOffset;

			let isLeaf = ( boundsInfox & 0xffff0000u ) != 0u;

			if ( isLeaf ) {

				let count = boundsInfox & 0x0000ffffu;
				let offset = boundsInfoy;

				let localHit = intersectTriangles(
					bvh_position, bvh_index, offset,
					count, ray
				);

				if ( localHit.didHit && localHit.dist < bestHit.dist ) {

					bestHit = localHit;

				}

			} else {

				let leftIndex = currNodeIndex + 1u;
				let splitAxis = boundsInfox & 0x0000ffffu;
				let rightIndex = currNodeIndex + boundsInfoy;

				let leftToRight = ray.direction[splitAxis] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				pointer = pointer + 1;
				stack[ pointer ] = c2;

				pointer = pointer + 1;
				stack[ pointer ] = c1;

			}

		}

		return bestHit;

	}

`,[pe,Q,y,Y,w,R]),a={enableRaytracing:!0,animate:!0,resolutionScale:1/window.devicePixelRatio,smoothNormals:!0};let e,o,c,n,b,E,m,O,u,s,t,P=[];const x=[8,8,1];ve();function ve(){e=new Z({canvas:document.createElement("canvas"),antialias:!0,forceWebGL:!1}),e.setAnimationLoop(ge),e.setPixelRatio(window.devicePixelRatio),e.setClearColor(594970),e.setSize(window.innerWidth,window.innerHeight),e.outputColorSpace=_,document.body.appendChild(e.domElement),c=new k;const i=new V(16777215,1);i.position.set(1,1,1),c.add(i),c.add(new z(11583173,.5)),o=new L(75,window.innerWidth/window.innerHeight,1,10),o.position.set(0,0,4),o.updateProjectionMatrix(),b=new de,document.body.appendChild(b.dom);const r=new B(1,.3,300,50),d=new ce(r,{maxLeafSize:1,strategy:ue});m=new D(r,new F),c.add(m),O=new K;const l=new f(r.index.array,3),I=new f(r.attributes.position.array,3),T=new f(r.attributes.normal.array,3),S=new f(new Float32Array(d._roots[0]),8),A={outputTex:q(t),smoothNormals:v(1),inverseProjectionMatrix:v(new H),cameraToModelMatrix:v(new H),geom_index:g(l,"uvec3",l.count).toReadOnly(),geom_position:g(I,"vec3",I.count).toReadOnly(),geom_normals:g(T,"vec3",T.count).toReadOnly(),bvh:g(S,"BVHNode",S.count).toReadOnly(),workgroupSize:v(new W),workgroupId:ee,localId:$};s=p(`

		fn compute(
			outputTex: texture_storage_2d<rgba8unorm, write>,
			smoothNormals: u32,
			inverseProjectionMatrix: mat4x4f,
			cameraToModelMatrix: mat4x4f,
			geom_position: ptr<storage, array<vec3f>, read>,
			geom_index: ptr<storage, array<vec3u>, read>,
			geom_normals: ptr<storage, array<vec3f>, read>,
			bvh: ptr<storage, array<BVHNode>, read>,
			workgroupSize: vec3u,
			workgroupId: vec3u,
			localId: vec3u,
		) -> void {

			// to screen coordinates
			let dimensions = textureDimensions( outputTex );
			let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;
			let uv = vec2f( indexUV ) / vec2f( dimensions );
			let ndc = uv * 2.0 - vec2f( 1.0 );

			// scene ray
			var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

			// get hit result
			let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

			// write result
			if ( hitResult.didHit && hitResult.dist < 1.0 ) {

				let normal = select(
					hitResult.normal,
					normalize( getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals ) ),
					smoothNormals > 0u,
				);
				textureStore( outputTex, indexUV, vec4f( normal, 1.0 ) );

			} else {

				let background = vec4f( 0.0366, 0.0813, 0.1057, 1.0 );
				textureStore( outputTex, indexUV, background );

			}

		}
	`,[J,fe,X])(A).computeKernel(x);const N=te("vec2","vUv"),C=p(`
		fn vertex( position: vec3f, uv: vec2f ) -> vec3f {
			varyings.vUv = uv;
			return position;
		}
	`,[N]);u=new oe,u.positionNode=C({position:M("position"),uv:M("uv")}),u.colorNode=re(ie(t,N),_),E=new ne(u),new se(o,e.domElement),n=new le,n.add(a,"enableRaytracing"),n.add(a,"animate"),n.add(a,"smoothNormals"),n.add(a,"resolutionScale",.1,1,.01).onChange(h),n.open(),window.addEventListener("resize",h,!1),h()}function h(){const i=window.innerWidth,r=window.innerHeight,d=window.devicePixelRatio,l=a.resolutionScale;o.aspect=i/r,o.updateProjectionMatrix(),e.setSize(i,r),e.setPixelRatio(d),t&&t.dispose(),t=new ae(i*d*l,r*d*l),t.format=U,t.type=j,t.magFilter=G}function ge(){b.update();const i=O.getDelta();a.animate&&(m.rotation.y+=i),a.enableRaytracing?(P=[Math.ceil(t.width/x[0]),Math.ceil(t.height/x[1])],o.updateMatrixWorld(),m.updateMatrixWorld(),s.computeNode.parameters.outputTex.value=t,s.computeNode.parameters.smoothNormals.value=Number(a.smoothNormals),s.computeNode.parameters.inverseProjectionMatrix.value=o.projectionMatrixInverse,s.computeNode.parameters.cameraToModelMatrix.value.copy(m.matrixWorld).invert().multiply(o.matrixWorld),s.computeNode.parameters.workgroupSize.value.fromArray(x),e.compute(s,P),u.colorNode.colorNode.value=t,E.render(e)):e.render(c,o)}
//# sourceMappingURL=webgpu_gpuPathTracingSimple-CRErdbfd.js.map
