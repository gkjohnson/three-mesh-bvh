import{H as e,Ht as t,Y as n,Yr as r,b as i,f as a,gr as o,o as s,on as c,p as l,pn as u,rr as d}from"./ExtendedTriangle-DOKLf4jx.js";import{t as f}from"./Pass-WYNZO8G0.js";import{t as p}from"./lil-gui.module.min-CCk8J1jY.js";import{t as m}from"./GLTFLoader-p6qoQbZ1.js";import{t as h}from"./OrbitControls-BX2ddTIw.js";import{t as g}from"./meshopt_decoder.module-DDLmvpjg.js";import{t as _}from"./stats.module-BDErWxYO.js";import{C as v,_ as y,b,c as x,f as S,i as C,m as w,o as T,p as E,s as D,t as O,u as k,x as A}from"./BVHComputeData-BuNvKHpP.js";var j=class extends b{constructor(e){super();let n={surface:S(0),normalStep:S(new r),projectionInverse:S(new t),sdfTransformInverse:S(new t),sdfTransform:S(new t),uv:w(E()),sdf_sampler:D(e),sdf:k(e)},i=y(`
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
		`,[y(`
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
		`)]);this.fragmentNode=i(n);let a={position:T},o=y(`

			fn noop(position: vec4f) -> vec4f {
				return position;
			}

		`);this.vertexNode=o(a)}},M=class extends b{constructor(e){super();let t=y(`
			fn distToColor(dist: f32) -> vec4f {
				if (dist > 0.0) {
					return vec4f(0.0, dist, 0.0, 1.0);
				} else {
					return vec4f(-dist, 0.0, 0.0, 1.0);
				}
			}
		`),n={layer:S(0),grid_mode:S(!1),uv:w(E()),sdf_sampler:D(e),sdf:k(e)},r=y(`
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

		`,[t]);this.fragmentNode=r(n);let i={position:T},a=y(`

			fn noop(position: vec4f) -> vec4f {
				return position;
			}

		`);this.vertexNode=a(i)}},N=[4,4,4],P={resolution:75,margin:.2,regenerate:()=>Z(),mode:`raymarching`,layer:0,surface:.1},F,I,L,R,z,B,V,H,U,W,G,K,q,J=new t;Y().then(Q);async function Y(){if(!await navigator.gpu.requestAdapter())throw document.body.appendChild($()),Error(`No WebGPU support`);V=document.getElementById(`output`),F=new v,F.setPixelRatio(window.devicePixelRatio),F.setSize(window.innerWidth,window.innerHeight),F.setClearColor(0,0),document.body.appendChild(F.domElement),await F.init(),L=new o;let n=new e(16777215,3);n.position.set(1,1,1),L.add(n),L.add(new s(16777215,.2)),I=new c(75,window.innerWidth/window.innerHeight,.1,50),I.position.set(1,1,2),I.far=100,I.updateProjectionMatrix(),B=new l(new a),L.add(B),new h(I,F.domElement),z=new _,document.body.appendChild(z.dom),U=(await new m().setMeshoptDecoder(g).loadAsync(`https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb`)).scene,U.updateMatrixWorld(!0),new a().setFromObject(U).getCenter(U.position).multiplyScalar(-1),U.updateMatrixWorld(!0),L.add(U),K=new O(U,{attributes:{position:`vec4f`}}),K.update();let r={matrix:S(new t),dim:S(0),globalId:C,output:x(H)};q=y(`

		fn computeSdf(
			matrix: mat4x4f,
			dim: u32,
			globalId: vec3u,

			output: texture_storage_3d<r32float, write>,
		) -> void {

			if ( globalId.x >= dim || globalId.y >= dim || globalId.z >= dim ) {

				return;

			}

			let pxWidth = 1.0 / f32( dim );
			let halfWidth = 0.5 * pxWidth;
			let pointHomo = vec4f(
				halfWidth + f32( globalId.x ) * pxWidth - 0.5,
				halfWidth + f32( globalId.y ) * pxWidth - 0.5,
				halfWidth + f32( globalId.z ) * pxWidth - 0.5,
				1.0
			) * matrix;
			let point = pointHomo.xyz / pointHomo.w;

			var pointResult: PointQueryResult;
			bvh_ClosestPointToPoint( point, &pointResult );

			var rayResult: IntersectionResult;
			let ray = Ray( point, vec3f( 0.0, 0.0, 1.0 ) );
			bvh_RaycastFirstHit( ray, &rayResult );

			let side = select( 1.0, rayResult.side, rayResult.didHit );
			let value = side * sqrt( pointResult.distanceSq );

			textureStore( output, globalId, vec4f( value, 0.0, 0.0, 0.0 ) );

		}

	`,[K.fns.closestPointToPoint,K.fns.raycastFirstHit])(r).computeKernel(N),X(),window.addEventListener(`resize`,function(){I.aspect=window.innerWidth/window.innerHeight,I.updateProjectionMatrix(),F.setSize(window.innerWidth,window.innerHeight)},!1),Z(),W=new f(new M(H)),G=new f(new j(H))}function X(){R&&R.destroy(),P.layer=Math.min(P.resolution,P.layer),R=new p;let e=R.addFolder(`generation`);e.add(P,`resolution`,10,200,1),e.add(P,`margin`,0,1),e.add(P,`regenerate`);let t=R.addFolder(`display`);t.add(P,`mode`,[`geometry`,`raymarching`,`layer`,`grid layers`]).onChange(()=>{X()}),P.mode===`layer`&&t.add(P,`layer`,0,P.resolution-1,1),P.mode===`raymarching`&&t.add(P,`surface`,-.2,.5)}function Z(){let e=P.resolution,o=new t,s=new r,c=new u,l=new r,f=new a().setFromObject(U);if(f.getCenter(s),l.subVectors(f.max,f.min),l.x+=2*P.margin,l.y+=2*P.margin,l.z+=2*P.margin,o.compose(s,c,l),J.copy(o).invert(),B.box.copy(f),B.box.min.x-=P.margin,B.box.min.y-=P.margin,B.box.min.z-=P.margin,B.box.max.x+=P.margin,B.box.max.y+=P.margin,B.box.max.z+=P.margin,H&&H.dispose(),H=new A(e,e,e),H.format=d,H.type=n,H.generateMipmaps=!1,H.needsUpdate=!0,H.wrapR=i,H.wrapS=i,H.wrapT=i,q&&(q.computeNode.parameters.output.value=H),W){let e=W.material;e.fragmentNode.parameters.sdf.value=H,e.fragmentNode.parameters.sdf_sampler.node.value=H}if(G){let e=G.material;e.fragmentNode.parameters.sdf.value=H,e.fragmentNode.parameters.sdf_sampler.node.value=H}let p=window.performance.now();q.computeNode.parameters.matrix.value.copy(o),q.computeNode.parameters.dim.value=e;let m=[Math.ceil(e/N[0]),Math.ceil(e/N[1]),Math.ceil(e/N[2])];F.compute(q,m),F.backend.device!==null&&F.backend.device.queue.onSubmittedWorkDone().then(()=>{let e=window.performance.now()-p;V.innerText=`${e.toFixed(2)}ms`}),X()}function Q(){if(z.update(),requestAnimationFrame(Q),H){if(P.mode===`geometry`)F.render(L,I);else if(P.mode===`layer`||P.mode===`grid layers`){let e=W.material;e.fragmentNode.parameters.layer.value=P.layer,e.fragmentNode.parameters.grid_mode.value=P.mode===`grid layers`,W.render(F)}else if(P.mode===`raymarching`){I.updateMatrixWorld(),U.updateMatrixWorld();let e=G.material;e.fragmentNode.parameters.surface.value=P.surface,e.fragmentNode.parameters.normalStep.value.set(1,1,1).divideScalar(H.width),e.fragmentNode.parameters.projectionInverse.value.copy(I.projectionMatrixInverse);let n=new t().copy(J).multiply(I.matrixWorld);e.fragmentNode.parameters.sdfTransformInverse.value.copy(n),n.invert(),e.fragmentNode.parameters.sdfTransform.value.copy(n),G.render(F)}}}function $(){let e=document.createElement(`div`);return e.id=`webgpumessage`,e.style.fontFamily=`monospace`,e.style.fontSize=`13px`,e.style.fontWeight=`normal`,e.style.textAlign=`center`,e.style.background=`#fff`,e.style.color=`#000`,e.style.padding=`1.5em`,e.style.maxWidth=`400px`,e.style.margin=`5em auto 0`,e.innerHTML=`Your browser does not support <a href="https://gpuweb.github.io/gpuweb/" style="color:blue">WebGPU</a> yet`,e}
//# sourceMappingURL=webgpu_sdfGeneration-B36uytX1.js.map