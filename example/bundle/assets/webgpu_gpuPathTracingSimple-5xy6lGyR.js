import{ah as N,c as C,D as k,A as L,P as V,T as z,M as B,g as D,V as F,n as _,a0 as W,av as U,L as j,h as G}from"./ExtendedTriangle-DttJMGjs.js";import{w as p,i as K,r as w,b as Q,a as h,W as Y,S as f,u as v,s as g,t as Z,n as q,g as J,c as X,l as $,d as ee,v as te,M as re,e as H,f as oe,h as ie,j as ae}from"./common_functions.wgsl-CjdvKpsU.js";import{O as se}from"./OrbitControls--aO4oMeG.js";import{F as ne}from"./Pass-C67NYBa3.js";import{S as de}from"./stats.module--VATS4Kh.js";import{g as le}from"./lil-gui.module.min-BH_YJbPT.js";import{M as ce,S as ue}from"./MeshBVH-DAC57waP.js";const me=p(`

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

`,[w,h]),pe=p(`

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

`,[me,w,h]),fe=p(`

	fn bvhIntersectFirstHit(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>,read>,
		ray: Ray,
	) -> IntersectionResult {

		var ptr = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = 0u;

		var bestHit: IntersectionResult;

		bestHit.didHit = false;
		bestHit.dist = INFINITY;

		loop {

			if ( ptr < 0 || ptr >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ ptr ];
			let node = bvh[ currNodeIndex ];

			ptr = ptr - 1;

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
				let rightIndex = 4u * boundsInfoy / 32u;

				let leftToRight = ray.direction[splitAxis] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				ptr = ptr + 1;
				stack[ ptr ] = c2;

				ptr = ptr + 1;
				stack[ ptr ] = c1;

			}

		}

		return bestHit;

	}

`,[pe,K,w,Q,h]),a={enableRaytracing:!0,animate:!0,resolutionScale:1/window.devicePixelRatio,smoothNormals:!0};let e,r,c,n,y,P,m,E,u,s,t,M=[];const x=[8,8,1];ve();function ve(){e=new Y({canvas:document.createElement("canvas"),antialias:!0,forceWebGL:!1}),e.setAnimationLoop(ge),e.setPixelRatio(window.devicePixelRatio),e.setClearColor(594970),e.setSize(window.innerWidth,window.innerHeight),e.outputColorSpace=N,document.body.appendChild(e.domElement),c=new C;const i=new k(16777215,1);i.position.set(1,1,1),c.add(i),c.add(new L(11583173,.5)),r=new V(75,window.innerWidth/window.innerHeight,1,10),r.position.set(0,0,4),r.updateProjectionMatrix(),y=new de,document.body.appendChild(y.dom);const o=new z(1,.3,300,50),d=new ce(o,{maxLeafTris:1,strategy:ue});m=new B(o,new D),c.add(m),E=new G;const l=new f(o.index.array,3),R=new f(o.attributes.position.array,3),I=new f(o.attributes.normal.array,3),T=new f(new Float32Array(d._roots[0]),8),O={outputTex:Z(t),smoothNormals:v(1),inverseProjectionMatrix:v(new _),cameraToModelMatrix:v(new _),geom_index:g(l,"uvec3",l.count).toReadOnly(),geom_position:g(R,"vec3",R.count).toReadOnly(),geom_normals:g(I,"vec3",I.count).toReadOnly(),bvh:g(T,"BVHNode",T.count).toReadOnly(),workgroupSize:v(new F),workgroupId:ee,localId:$};s=p(`

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
	`,[q,fe,J,h,X])(O).computeKernel(x);const S=te("vec2","vUv"),A=p(`
		fn vertex( position: vec3f, uv: vec2f ) -> vec3f {
			varyings.vUv = uv;
			return position;
		}
	`,[S]);u=new re,u.positionNode=A({position:H("position"),uv:H("uv")}),u.colorNode=oe(ie(t,S),N),P=new ne(u),new se(r,e.domElement),n=new le,n.add(a,"enableRaytracing"),n.add(a,"animate"),n.add(a,"smoothNormals"),n.add(a,"resolutionScale",.1,1,.01).onChange(b),n.open(),window.addEventListener("resize",b,!1),b()}function b(){const i=window.innerWidth,o=window.innerHeight,d=window.devicePixelRatio,l=a.resolutionScale;r.aspect=i/o,r.updateProjectionMatrix(),e.setSize(i,o),e.setPixelRatio(d),t&&t.dispose(),t=new ae(i*d*l,o*d*l),t.format=W,t.type=U,t.magFilter=j}function ge(){y.update();const i=E.getDelta();a.animate&&(m.rotation.y+=i),a.enableRaytracing?(M=[Math.ceil(t.width/x[0]),Math.ceil(t.height/x[1])],r.updateMatrixWorld(),m.updateMatrixWorld(),s.computeNode.parameters.outputTex.value=t,s.computeNode.parameters.smoothNormals.value=Number(a.smoothNormals),s.computeNode.parameters.inverseProjectionMatrix.value=r.projectionMatrixInverse,s.computeNode.parameters.cameraToModelMatrix.value.copy(m.matrixWorld).invert().multiply(r.matrixWorld),s.computeNode.parameters.workgroupSize.value.fromArray(x),e.compute(s,M),u.colorNode.colorNode.value=t,P.render(e)):e.render(c,r)}
