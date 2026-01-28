import{n as x,V as B,c as K,D as Q,A as X,P as Y,aQ as Z,b as $,M as J,g as ee,af as te,R as oe,F as re,as as _}from"./ExtendedTriangle-hsPasuNU.js";import{w as i,b as C,k as q,N as W,m as H,o as F,p as A,q as O,u as c,x as k,W as ne,S as I,y as ae,s as P,z as ie,A as se}from"./common_functions.wgsl-on0d7Tki.js";import{M as de}from"./meshopt_decoder.module-j6OW_3Rk.js";import{G as le}from"./GLTFLoader-Be-eETKy.js";import{F as z}from"./Pass-BOKrxmL7.js";import{O as ce}from"./OrbitControls-DEZHvbFX.js";import{g as fe}from"./lil-gui.module.min-BH_YJbPT.js";import{S as me}from"./stats.min-DbzWzcqd.js";import{G as ue}from"./GenerateMeshBVHWorker-vOgOjCfJ.js";import{S as pe}from"./StaticGeometryGenerator-QNaaaoUl.js";import"./BufferGeometryUtils-BuPYlHUL.js";import"./_commonjsHelpers-CqkleIqs.js";import"./MeshBVH-DQV6PBDm.js";const E=q(`
	struct ClosestPointToPointResult {
		faceIndices: vec4u,
		faceNormal: vec3f,
		barycoord: vec3f,
		point: vec3f,
		side: f32,
		distanceSq: f32,
		found: bool,
	};
`),ve=q(`
	struct ClosestPointToTriangleResult {
		barycoord: vec3f,
		point: vec3f,
	};
`),xe=i(`

	fn closestPointToTriangle( p: vec3f, v0: vec3f, v1: vec3f, v2: vec3f ) -> ClosestPointToTriangleResult {
		// https://www.shadertoy.com/view/ttfGWl

		let v10 = v1 - v0;
		let v21 = v2 - v1;
		let v02 = v0 - v2;

		let p0 = p - v0;
		let p1 = p - v1;
		let p2 = p - v2;

		let nor = cross( v10, v02 );

		// method 2, in barycentric space
		let  q = cross( nor, p0 );
		let d = 1.0 / dot( nor, nor );
		var u = d * dot( q, v02 );
		var v = d * dot( q, v10 );
		var w = 1.0 - u - v;

		if( u < 0.0 ) {

			w = clamp( dot( p2, v02 ) / dot( v02, v02 ), 0.0, 1.0 );
			u = 0.0;
			v = 1.0 - w;

		} else if( v < 0.0 ) {

			u = clamp( dot( p0, v10 ) / dot( v10, v10 ), 0.0, 1.0 );
			v = 0.0;
			w = 1.0 - u;

		} else if( w < 0.0 ) {

			v = clamp( dot( p1, v21 ) / dot( v21, v21 ), 0.0, 1.0 );
			w = 0.0;
			u = 1.0 - v;

		}

		var result: ClosestPointToTriangleResult;
		result.barycoord = vec3f( u, v, w );
		result.point = u * v1 + v * v2 + w * v0;

		return result;

	}
`,[ve]),ge=i(`
	fn distanceToTriangles(
		// geometry info and triangle range
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,

		offset: u32, count: u32,

		// point and current result. Cut off range is taken from the struct
		point: vec3f,
		ioRes: ptr<function, ClosestPointToPointResult>,
	) -> void {

		for ( var i = offset; i < offset + count; i = i + 1u ) {

			let indices = bvh_index[ i ];
			let a = bvh_position[ indices.x ];
			let b = bvh_position[ indices.y ];
			let c = bvh_position[ indices.z ];

			// get the closest point and barycoord
			let pointRes = closestPointToTriangle( point, a, b, c );
			let delta = point - pointRes.point;
			let distSq = dot( delta, delta );
			if ( distSq < ioRes.distanceSq ) {

				// set the output results
				ioRes.distanceSq = distSq;
				ioRes.faceIndices = vec4u( indices.xyz, i );
				ioRes.faceNormal = normalize( cross( a - b, b - c ) );
				ioRes.barycoord = pointRes.barycoord;
				ioRes.point = pointRes.point;
				ioRes.side = sign( dot( ioRes.faceNormal, delta ) );

			}

		}

	}
`,[xe,E]),ye=i(`
	fn distanceSqToBounds( point: vec3f, boundsMin: vec3f, boundsMax: vec3f ) -> f32 {

		let clampedPoint = clamp( point, boundsMin, boundsMax );
		let delta = point - clampedPoint;
		return dot( delta, delta );

	}
`),he=i(`
	fn distanceSqToBVHNodeBoundsPoint(
		point: vec3f,
		bvh: ptr<storage, array<BVHNode>, read>,
		currNodeIndex: u32,
	) -> f32 {

		let node = bvh[ currNodeIndex ];
		let minBounds = vec3f(node.bounds.min[0], node.bounds.min[1], node.bounds.min[2]);
		let maxBounds = vec3f(node.bounds.max[0], node.bounds.max[1], node.bounds.max[2]);
		return distanceSqToBounds( point, minBounds, maxBounds );

	}
`,[ye,C]),be=i(`
	fn bvhClosestPointToPoint(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>, read>,

		point: vec3f,
		maxDistance: f32
	) -> ClosestPointToPointResult {

		const BVH_STACK_DEPTH = 64;

		// stack needs to be twice as long as the deepest tree we expect because
		// we push both the left and right child onto the stack every traversal
		var pointer = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = 0u;

		var res: ClosestPointToPointResult;
		res.distanceSq = maxDistance * maxDistance;

		while pointer > - 1 && pointer < BVH_STACK_DEPTH {

			let currNodeIndex = stack[ pointer ];
			let node = bvh[ currNodeIndex ];
			pointer = pointer - 1;

			// check if we intersect the current bounds
			let boundsDistance = distanceSqToBVHNodeBoundsPoint( point, bvh, currNodeIndex );
			if ( boundsDistance > res.distanceSq ) {

				continue;

			}

			let boundsInfox = node.splitAxisOrTriangleCount;
			let boundsInfoy = node.rightChildOrTriangleOffset;

			let isLeaf = ( boundsInfox & 0xffff0000u ) != 0u;

			if ( isLeaf ) {

				let count = boundsInfox & 0x0000ffffu;
				let offset = boundsInfoy;
				distanceToTriangles(
					bvh_index, bvh_position,
					offset, count,
					point, &res
				);

			} else {

				let leftIndex = currNodeIndex + 1u;
				let splitAxis = boundsInfox & 0x0000ffffu;
				let rightIndex = currNodeIndex + boundsInfoy;

				let leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh, rightIndex );
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				pointer = pointer + 1;
				stack[ pointer ] = c2;

				pointer = pointer + 1;
				stack[ pointer ] = c1;

			}

		}

		return res;

	}
`,[C,E,ge,he]);class we extends W{constructor(e){super();const d={surface:c(0),normalStep:c(new B),projectionInverse:c(new x),sdfTransformInverse:c(new x),sdfTransform:c(new x),uv:A(O()),sdf_sampler:F(e),sdf:H(e)},f=i(`
			fn rayBoxDist(boundsMin: vec3f, boundsMax: vec3f, rayOrigin: vec3f, rayDir: vec3f) -> vec2f {
				let t0 = (boundsMin - rayOrigin) / rayDir;
				let t1 = (boundsMax - rayOrigin) / rayDir;
				let tmin = min(t0, t1);
				let tmax = max(t0, t1);

				let distA = max( max( tmin.x, tmin.y ), tmin.z );
				let distB = min( tmax.x, min( tmax.y, tmax.z ) );

				let distToBox = max( 0.0, distA );
				let distInsideBox = max( 0.0, distB - distToBox );
				return vec2f( distToBox, distInsideBox );
			}
		`),a=i(`
			fn raymarch(
				surface: f32,
				projectionInverse: mat4x4f,
				sdfTransformInverse: mat4x4f,
				sdfTransform: mat4x4f,
				normalStep: vec3f,

				uv: vec2f,
				sdf_sampler: sampler,
				sdf: texture_3d<f32>,
			) -> vec4f {
				const MAX_STEPS: i32 = 500;
				const SURFACE_EPSILON: f32 = 0.001;

				let clipSpace = 2.0 * uv - vec2f( 1.0, 1.0 );

				let rayOrigin = vec3f( 0.0, 0.0, 0.0 );
				let homogenousDirection = projectionInverse * vec4f( clipSpace, -1.0, 1.0 );
				let rayDirection = normalize( homogenousDirection.xyz / homogenousDirection.w );

				let sdfRayOrigin = ( sdfTransformInverse * vec4f( rayOrigin, 1.0 ) ).xyz;
				let sdfRayDirection = normalize( ( sdfTransformInverse * vec4f( rayDirection, 0.0 ) ).xyz );

				let boxIntersectionInfo = rayBoxDist( vec3f( -0.5 ), vec3f( 0.5 ), sdfRayOrigin, sdfRayDirection );
				let distToBox = boxIntersectionInfo.x;
				let distInsideBox = boxIntersectionInfo.y;
				let intersectsBox = distInsideBox > 0.0;

				var color = vec4f( 0.0 );

				if ( intersectsBox ) {

					var intersectsSurface = false;
					var localPoint = vec4f( sdfRayOrigin + sdfRayDirection * ( distToBox + 1e-5 ), 1.0 );
					var point = sdfTransform * localPoint;

					for ( var i: i32 = 0; i < MAX_STEPS; i = i + 1 ) {

						let uv3 = ( sdfTransformInverse * point ).xyz + vec3f( 0.5 );

						if ( uv3.x < 0.0 || uv3.x > 1.0 || uv3.y < 0.0 || uv3.y > 1.0 || uv3.z < 0.0 || uv3.z > 1.0 ) {
							break;
						}

						let distanceToSurface = textureSample( sdf, sdf_sampler, uv3 ).r - surface;
						if ( distanceToSurface < SURFACE_EPSILON ) {
							intersectsSurface = true;
							break;
						}

						point = vec4f(point.xyz + rayDirection * distanceToSurface, point.w);
					}

					if ( intersectsSurface ) {

						let uv3 = ( sdfTransformInverse * point ).xyz + vec3f( 0.5 );

						let dx = textureSample( sdf, sdf_sampler, uv3 + vec3f( normalStep.x, 0.0, 0.0 ) ).r
							- textureSample( sdf, sdf_sampler, uv3 - vec3f( normalStep.x, 0.0, 0.0 ) ).r;

						let dy = textureSample( sdf, sdf_sampler, uv3 + vec3f( 0.0, normalStep.y, 0.0 ) ).r
							- textureSample( sdf, sdf_sampler, uv3 - vec3f( 0.0, normalStep.y, 0.0 ) ).r;

						let dz = textureSample( sdf, sdf_sampler, uv3 + vec3f( 0.0, 0.0, normalStep.z ) ).r
							- textureSample( sdf, sdf_sampler, uv3 - vec3f( 0.0, 0.0, normalStep.z ) ).r;

						let normal = normalize( vec3f( dx, dy, dz ) );

						let lightDirection = normalize( vec3f( 1.0, 1.0, 1.0 ) );
						let lightIntensity =
							saturate( dot( normal, lightDirection ) ) +
							saturate( dot( normal, -lightDirection ) ) * 0.05 +
							0.1;

						color = vec4f( vec3f( lightIntensity ), 1.0 );
					}
				}

				return color;
			}
		`,[f]);this.fragmentNode=a(d);const m={position:k},u=i(`

			fn noop(position: vec4f) -> vec4f {
				return position;
			}

		`);this.vertexNode=u(m)}}class Se extends W{constructor(e){super();const d=i(`
			fn distToColor(dist: f32) -> vec4f {
				if (dist > 0.0) {
					return vec4f(0.0, dist, 0.0, 1.0);
				} else {
					return vec4f(-dist, 0.0, 0.0, 1.0);
				}
			}
		`),f={layer:c(0),grid_mode:c(!1),uv:A(O()),sdf_sampler:F(e),sdf:H(e)};let a=i(`
			fn layer(
				layer: u32,
				grid_mode: bool,

				uv: vec2f,
				sdf_sampler: sampler,
				sdf: texture_3d<f32>,
			) -> vec4f {
				let dim = textureDimensions( sdf ).x;

				var texelCoords = vec3f(uv, f32(layer) / f32(dim));

				if (grid_mode) {
					let square_size = ceil(sqrt(f32(dim)));
					let max_image_offset = vec2f(square_size - 1.0, square_size - 1.0);
					let new_uv = uv * square_size;
					let image_offset = min(floor(new_uv), max_image_offset);
					let in_image_uv = new_uv - image_offset;
					let z_layer = image_offset.x + (square_size - 1 - image_offset.y) * square_size;
					if (z_layer >= f32(dim)) {
						return vec4f(0.0, 0.0, 0.0, 1.0);
					}
					texelCoords = vec3f(in_image_uv, z_layer / f32(dim));
				}
				let dist = textureSample(sdf, sdf_sampler, texelCoords).r;
				return distToColor(dist);
			}

		`,[d]);this.fragmentNode=a(f);const m={position:k},u=i(`

			fn noop(position: vec4f) -> vec4f {
				return position;
			}

		`);this.vertexNode=u(m)}}const T=[4,4,4],t={resolution:75,margin:.2,regenerate:()=>L(),mode:"raymarching",layer:0,surface:.1};let n,s,g,b,N,l,V,M,v,r,h,w,S,D,y;const G=new x;Te().then(j);async function Te(){if(!await navigator.gpu.requestAdapter())throw document.body.appendChild(_e()),new Error("No WebGPU support");V=document.getElementById("output"),n=new ne,n.setPixelRatio(window.devicePixelRatio),n.setSize(window.innerWidth,window.innerHeight),n.setClearColor(0,0),document.body.appendChild(n.domElement),await n.init(),g=new K;const o=new Q(16777215,1);o.position.set(1,1,1),g.add(o),g.add(new X(16777215,.2)),s=new Y(75,window.innerWidth/window.innerHeight,.1,50),s.position.set(1,1,2),s.far=100,s.updateProjectionMatrix(),l=new Z(new $),g.add(l),new ce(s,n.domElement),N=new me,document.body.appendChild(N.dom),D=new ue;const e=await new le().setMeshoptDecoder(de).loadAsync("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb");e.scene.updateMatrixWorld(!0);const d=new pe(e.scene);d.attributes=["position","normal"],d.useGroups=!1,v=d.generate().center(),M=await D.generate(v,{maxLeafSize:1}),h=new J(v,new ee),g.add(h);const f=new I(h.geometry.index.array,3),a=new I(h.geometry.attributes.position.array,3),m=new I(new Float32Array(M._roots[0]),8),u={matrix:c(new x),dim:c(0),bvh_index:P(f,"uvec3",f.count).toReadOnly(),bvh_position:P(a,"vec3",a.count).toReadOnly(),bvh:P(m,"BVHNode",m.count).toReadOnly(),globalId:ie,output:ae(r)};y=i(`

		fn computeSdf(
			bvh_index: ptr<storage, array<vec3u>, read>,
			bvh_position: ptr<storage, array<vec3f>, read>,
			bvh: ptr<storage, array<BVHNode>, read>,

			matrix: mat4x4f,
			dim: u32,
			globalId: vec3u,

			output: texture_storage_3d<r32float, write>,
		) -> void {
			if (globalId.x >= dim) {
				return;
			}
			if (globalId.y >= dim) {
				return;
			}
			if (globalId.z >= dim) {
				return;
			}

			let pxWidth = 1.0 / f32(dim);
			let halfWidth = 0.5 * pxWidth;
			let pointHomo = vec4f(
				halfWidth + f32(globalId.x) * pxWidth - 0.5,
				halfWidth + f32(globalId.y) * pxWidth - 0.5,
				halfWidth + f32(globalId.z) * pxWidth - 0.5,
				1.0
			) * matrix;
			let point = pointHomo.xyz / pointHomo.w;

			let res = bvhClosestPointToPoint(bvh_index, bvh_position, bvh, point, 10000.0);
			let value = res.side * sqrt( res.distanceSq );

			let mipLevel = 0;
			textureStore(output, globalId, vec4f(value, 0.0, 0.0, 0.0));
		}

	`,[be])(u).computeKernel(T),R(),window.addEventListener("resize",function(){s.aspect=window.innerWidth/window.innerHeight,s.updateProjectionMatrix(),n.setSize(window.innerWidth,window.innerHeight)},!1),L(),w=new z(new Se(r)),S=new z(new we(r))}function R(){b&&b.destroy(),t.layer=Math.min(t.resolution,t.layer),b=new fe;const o=b.addFolder("generation");o.add(t,"resolution",10,200,1),o.add(t,"margin",0,1),o.add(t,"regenerate");const e=b.addFolder("display");e.add(t,"mode",["geometry","raymarching","layer","grid layers"]).onChange(()=>{R()}),t.mode==="layer"&&e.add(t,"layer",0,t.resolution-1,1),t.mode==="raymarching"&&e.add(t,"surface",-.2,.5)}function L(){const o=t.resolution,e=new x,d=new B,f=new te,a=new B;if(v.boundingBox.getCenter(d),a.subVectors(v.boundingBox.max,v.boundingBox.min),a.x+=2*t.margin,a.y+=2*t.margin,a.z+=2*t.margin,e.compose(d,f,a),G.copy(e).invert(),l.box.copy(v.boundingBox),l.box.min.x-=t.margin,l.box.min.y-=t.margin,l.box.min.z-=t.margin,l.box.max.x+=t.margin,l.box.max.y+=t.margin,l.box.max.z+=t.margin,r&&r.dispose(),r=new se(o,o,o),r.format=oe,r.type=re,r.generateMipmaps=!1,r.needsUpdate=!0,r.wrapR=_,r.wrapS=_,r.wrapT=_,y&&(y.computeNode.parameters.output.value=r),w){const p=w.material;p.fragmentNode.parameters.sdf.value=r,p.fragmentNode.parameters.sdf_sampler.node.value=r}if(S){const p=S.material;p.fragmentNode.parameters.sdf.value=r,p.fragmentNode.parameters.sdf_sampler.node.value=r}const m=window.performance.now();y.computeNode.parameters.matrix.value.copy(e),y.computeNode.parameters.dim.value=o;const u=[Math.ceil(o/T[0]),Math.ceil(o/T[1]),Math.ceil(o/T[2])];n.compute(y,u),n.backend.device!==null&&n.backend.device.queue.onSubmittedWorkDone().then(()=>{const U=window.performance.now()-m;V.innerText=`${U.toFixed(2)}ms`}),R()}function j(){if(N.update(),requestAnimationFrame(j),r){if(t.mode==="geometry")n.render(g,s);else if(t.mode==="layer"||t.mode==="grid layers"){const o=w.material;o.fragmentNode.parameters.layer.value=t.layer,o.fragmentNode.parameters.grid_mode.value=t.mode==="grid layers",w.render(n)}else if(t.mode==="raymarching"){s.updateMatrixWorld(),h.updateMatrixWorld();const o=S.material;o.fragmentNode.parameters.surface.value=t.surface,o.fragmentNode.parameters.normalStep.value.set(1,1,1).divideScalar(t.resolution),o.fragmentNode.parameters.projectionInverse.value.copy(s.projectionMatrixInverse);const e=new x().copy(h.matrixWorld).invert().premultiply(G).multiply(s.matrixWorld);o.fragmentNode.parameters.sdfTransformInverse.value.copy(e),e.invert(),o.fragmentNode.parameters.sdfTransform.value.copy(e),S.render(n)}}else return}function _e(){const o='Your browser does not support <a href="https://gpuweb.github.io/gpuweb/" style="color:blue">WebGPU</a> yet',e=document.createElement("div");return e.id="webgpumessage",e.style.fontFamily="monospace",e.style.fontSize="13px",e.style.fontWeight="normal",e.style.textAlign="center",e.style.background="#fff",e.style.color="#000",e.style.padding="1.5em",e.style.maxWidth="400px",e.style.margin="5em auto 0",e.innerHTML=o,e}
//# sourceMappingURL=webgpu_sdfGeneration-Cc6-Bwdi.js.map
