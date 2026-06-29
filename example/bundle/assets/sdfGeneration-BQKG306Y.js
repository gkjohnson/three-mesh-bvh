import{n as e}from"./chunk-Bh1tDfsg.js";import{H as t,Ht as n,M as r,Qr as i,Ut as a,Xt as o,Y as s,Yr as c,_r as l,ei as u,er as d,f,gr as p,i as m,kt as h,nt as g,o as _,on as v,p as y,pn as b,rr as x}from"./ExtendedTriangle-DOKLf4jx.js";import{t as S}from"./Pass-WYNZO8G0.js";import{t as ee}from"./MeshBVHUniformStruct-CoH4Jcnp.js";import{t as te}from"./StaticGeometryGenerator-C4jwtzd7.js";import{n as ne,r as C,t as w}from"./bvh_struct_definitions.glsl-D-uzwxra.js";import{t as T}from"./stats.min-CnMmk804.js";import{t as E}from"./lil-gui.module.min-CCk8J1jY.js";import{t as D}from"./GenerateMeshBVHWorker-B9qbYK0i.js";import{t as re}from"./GLTFLoader-p6qoQbZ1.js";import{t as ie}from"./OrbitControls-BX2ddTIw.js";import{t as O}from"./meshopt_decoder.module-DDLmvpjg.js";var k=`

float dot2( vec3 v ) {

	return dot( v, v );

}

// https://www.shadertoy.com/view/ttfGWl
vec3 closestPointToTriangle( vec3 p, vec3 v0, vec3 v1, vec3 v2, out vec3 barycoord ) {

    vec3 v10 = v1 - v0;
    vec3 v21 = v2 - v1;
    vec3 v02 = v0 - v2;

	vec3 p0 = p - v0;
	vec3 p1 = p - v1;
	vec3 p2 = p - v2;

    vec3 nor = cross( v10, v02 );

    // method 2, in barycentric space
    vec3  q = cross( nor, p0 );
    float d = 1.0 / dot2( nor );
    float u = d * dot( q, v02 );
    float v = d * dot( q, v10 );
    float w = 1.0 - u - v;

	if( u < 0.0 ) {

		w = clamp( dot( p2, v02 ) / dot2( v02 ), 0.0, 1.0 );
		u = 0.0;
		v = 1.0 - w;

	} else if( v < 0.0 ) {

		u = clamp( dot( p0, v10 ) / dot2( v10 ), 0.0, 1.0 );
		v = 0.0;
		w = 1.0 - u;

	} else if( w < 0.0 ) {

		v = clamp( dot( p1, v21 ) / dot2( v21 ), 0.0, 1.0 );
		w = 0.0;
		u = 1.0 - v;

	}

	barycoord = vec3( u, v, w );
    return u * v1 + v * v2 + w * v0;

}

float distanceToTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// point and cut off range
	vec3 point, float closestDistanceSquared,

	// outputs
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord, inout float side, inout vec3 outPoint
) {

	bool found = false;
	vec3 localBarycoord;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		// get the closest point and barycoord
		vec3 closestPoint = closestPointToTriangle( point, a, b, c, localBarycoord );
		vec3 delta = point - closestPoint;
		float sqDist = dot2( delta );
		if ( sqDist < closestDistanceSquared ) {

			// set the output results
			closestDistanceSquared = sqDist;
			faceIndices = uvec4( indices.xyz, i );
			faceNormal = normalize( cross( a - b, b - c ) );
			barycoord = localBarycoord;
			outPoint = closestPoint;
			side = sign( dot( faceNormal, delta ) );

		}

	}

	return closestDistanceSquared;

}

float distanceSqToBounds( vec3 point, vec3 boundsMin, vec3 boundsMax ) {

	vec3 clampedPoint = clamp( point, boundsMin, boundsMax );
	vec3 delta = point - clampedPoint;
	return dot( delta, delta );

}

float distanceSqToBVHNodeBoundsPoint( vec3 point, sampler2D bvhBounds, uint currNodeIndex ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return distanceSqToBounds( point, boundsMin, boundsMax );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhClosestPointToPoint(		bvh,		point, maxDistance, faceIndices, faceNormal, barycoord, side, outPoint	)	_bvhClosestPointToPoint(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		point, maxDistance, faceIndices, faceNormal, barycoord, side, outPoint	)

float _bvhClosestPointToPoint(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// point to check
	vec3 point, float maxDistance,

	// output variables
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout vec3 outPoint
 ) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int pointer = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float closestDistanceSquared = maxDistance * maxDistance;
	bool found = false;
	while ( pointer > - 1 && pointer < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ pointer ];
		pointer --;

		// check if we intersect the current bounds
		float boundsHitDistance = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, currNodeIndex );
		if ( boundsHitDistance > closestDistanceSquared ) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );
		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;
			closestDistanceSquared = distanceToTriangles(
				bvh_position, bvh_index, offset, count, point, closestDistanceSquared,

				// outputs
				faceIndices, faceNormal, barycoord, side, outPoint
			);

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = currNodeIndex + boundsInfo.y;
			bool leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, rightIndex );//rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			pointer ++;
			stack[ pointer ] = c2;
			pointer ++;
			stack[ pointer ] = c1;

		}

	}

	return sqrt( closestDistanceSquared );

}
`,A=e(T(),1),j=class extends l{constructor(e){super({defines:{USE_SHADER_RAYCAST:+!!window.location.hash.includes(`USE_SHADER_RAYCAST`)},uniforms:{matrix:{value:new n},zValue:{value:0},bvh:{value:new ee}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`

				precision highp isampler2D;
				precision highp usampler2D;

				${C}
				${w}
				${ne}
				${k}

				varying vec2 vUv;

				uniform BVH bvh;
				uniform float zValue;
				uniform mat4 matrix;

				void main() {

					// compute the point in space to check
					vec3 point = vec3( vUv, zValue );
					point -= vec3( 0.5 );
					point = ( matrix * vec4( point, 1.0 ) ).xyz;

					// retrieve the distance and other values
					uvec4 faceIndices;
					vec3 faceNormal;
					vec3 barycoord;
					float side;
					float rayDist;
					vec3 outPoint;
					float dist = bvhClosestPointToPoint( bvh, point.xyz, 100000.0, faceIndices, faceNormal, barycoord, side, outPoint );

					// This currently causes issues on some devices when rendering to 3d textures and texture arrays
					#if USE_SHADER_RAYCAST

					side = 1.0;
					bvhIntersectFirstHit( bvh, point.xyz, vec3( 0.0, 0.0, 1.0 ), faceIndices, faceNormal, barycoord, side, rayDist );

					#endif

					// if the triangle side is the back then it must be on the inside and the value negative
					gl_FragColor = vec4( side * dist, 0, 0, 0 );

				}

			`}),this.setValues(e)}},M=class extends l{constructor(e){super({defines:{DISPLAY_GRID:0},uniforms:{sdfTex:{value:null},layer:{value:0},layers:{value:0}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`
				precision highp sampler3D;

				varying vec2 vUv;
				uniform sampler3D sdfTex;
				uniform float layer;
				uniform float layers;

				void main() {

					#if DISPLAY_GRID

					float dim = ceil( sqrt( layers ) );
					vec2 cell = floor( vUv * dim );
					vec2 frac = vUv * dim - cell;
					float zLayer = ( cell.y * dim + cell.x ) / ( dim * dim );

					float dist = texture( sdfTex, vec3( frac, zLayer ) ).r;
					gl_FragColor.rgb = dist > 0.0 ? vec3( 0, dist, 0 ) : vec3( - dist, 0, 0 );
					gl_FragColor.a = 1.0;

					#else

					float dist = texture( sdfTex, vec3( vUv, layer ) ).r;
					gl_FragColor.rgb = dist > 0.0 ? vec3( 0, dist, 0 ) : vec3( - dist, 0, 0 );
					gl_FragColor.a = 1.0;

					#endif

					#include <colorspace_fragment>

				}
			`}),this.setValues(e)}},N=class extends l{constructor(e){super({defines:{MAX_STEPS:500,SURFACE_EPSILON:.001},uniforms:{surface:{value:0},sdfTex:{value:null},normalStep:{value:new c},projectionInverse:{value:new n},sdfTransformInverse:{value:new n}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`
				precision highp sampler3D;

				varying vec2 vUv;

				uniform float surface;
				uniform sampler3D sdfTex;
				uniform vec3 normalStep;
				uniform mat4 projectionInverse;
				uniform mat4 sdfTransformInverse;

				#include <common>

				// distance to box bounds
				vec2 rayBoxDist( vec3 boundsMin, vec3 boundsMax, vec3 rayOrigin, vec3 rayDir ) {

					vec3 t0 = ( boundsMin - rayOrigin ) / rayDir;
					vec3 t1 = ( boundsMax - rayOrigin ) / rayDir;
					vec3 tmin = min( t0, t1 );
					vec3 tmax = max( t0, t1 );

					float distA = max( max( tmin.x, tmin.y ), tmin.z );
					float distB = min( tmax.x, min( tmax.y, tmax.z ) );

					float distToBox = max( 0.0, distA );
					float distInsideBox = max( 0.0, distB - distToBox );
					return vec2( distToBox, distInsideBox );

				}

				void main() {

					// get the inverse of the sdf box transform
					mat4 sdfTransform = inverse( sdfTransformInverse );

					// convert the uv to clip space for ray transformation
					vec2 clipSpace = 2.0 * vUv - vec2( 1.0 );

					// get world ray direction
					vec3 rayOrigin = vec3( 0.0 );
					vec4 homogenousDirection = projectionInverse * vec4( clipSpace, - 1.0, 1.0 );
					vec3 rayDirection = normalize( homogenousDirection.xyz / homogenousDirection.w );

					// transform ray into local coordinates of sdf bounds
					vec3 sdfRayOrigin = ( sdfTransformInverse * vec4( rayOrigin, 1.0 ) ).xyz;
					vec3 sdfRayDirection = normalize( ( sdfTransformInverse * vec4( rayDirection, 0.0 ) ).xyz );

					// find whether our ray hits the box bounds in the local box space
					vec2 boxIntersectionInfo = rayBoxDist( vec3( - 0.5 ), vec3( 0.5 ), sdfRayOrigin, sdfRayDirection );
					float distToBox = boxIntersectionInfo.x;
					float distInsideBox = boxIntersectionInfo.y;
					bool intersectsBox = distInsideBox > 0.0;

					gl_FragColor = vec4( 0.0 );
					if ( intersectsBox ) {

						// find the surface point in world space
						bool intersectsSurface = false;
						vec4 localPoint = vec4( sdfRayOrigin + sdfRayDirection * ( distToBox + 1e-5 ), 1.0 );
						vec4 point = sdfTransform * localPoint;

						// ray march
						for ( int i = 0; i < MAX_STEPS; i ++ ) {

							// sdf box extends from - 0.5 to 0.5
							// transform into the local bounds space [ 0, 1 ] and check if we're inside the bounds
							vec3 uv = ( sdfTransformInverse * point ).xyz + vec3( 0.5 );
							if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || uv.z < 0.0 || uv.z > 1.0 ) {

								break;

							}

							// get the distance to surface and exit the loop if we're close to the surface
							float distanceToSurface = texture( sdfTex, uv ).r - surface;
							if ( distanceToSurface < SURFACE_EPSILON ) {

								intersectsSurface = true;
								break;

							}

							// step the ray
							point.xyz += rayDirection * abs( distanceToSurface );

						}

						// find the surface normal
						if ( intersectsSurface ) {

							// compute the surface normal
							vec3 uv = ( sdfTransformInverse * point ).xyz + vec3( 0.5 );
							float dx = texture( sdfTex, uv + vec3( normalStep.x, 0.0, 0.0 ) ).r - texture( sdfTex, uv - vec3( normalStep.x, 0.0, 0.0 ) ).r;
							float dy = texture( sdfTex, uv + vec3( 0.0, normalStep.y, 0.0 ) ).r - texture( sdfTex, uv - vec3( 0.0, normalStep.y, 0.0 ) ).r;
							float dz = texture( sdfTex, uv + vec3( 0.0, 0.0, normalStep.z ) ).r - texture( sdfTex, uv - vec3( 0.0, 0.0, normalStep.z ) ).r;
							vec3 normal = normalize( vec3( dx, dy, dz ) );

							// compute some basic lighting effects
							vec3 lightDirection = normalize( vec3( 1.0 ) );
							float lightIntensity =
								saturate( dot( normal, lightDirection ) ) +
								saturate( dot( normal, - lightDirection ) ) * 0.05 +
								0.1;
							gl_FragColor.rgb = vec3( lightIntensity );
							gl_FragColor.a = 1.0;

						}

					}

					#include <colorspace_fragment>

				}
			`}),this.setValues(e)}},P={gpuGeneration:!0,resolution:75,margin:.2,regenerate:()=>Q(),mode:`raymarching`,layer:0,surface:.1},F,I,L,R,z,B,V,H,U,W,G,K,q,J,Y,X=new n;ae(),$();function ae(){V=document.getElementById(`output`),F=new m({antialias:!0}),F.setPixelRatio(window.devicePixelRatio),F.setSize(window.innerWidth,window.innerHeight),F.setClearColor(0,0),document.body.appendChild(F.domElement),L=new p;let e=new t(16777215,1);e.position.set(1,1,1),L.add(e),L.add(new _(16777215,.2)),I=new v(75,window.innerWidth/window.innerHeight,.1,50),I.position.set(1,1,2),I.far=100,I.updateProjectionMatrix(),B=new y(new f),L.add(B),new ie(I,F.domElement),z=new A.default,document.body.appendChild(z.dom),K=new S(new j),q=new S(new M),J=new S(new N),Y=new D,new re().setMeshoptDecoder(O).loadAsync(`https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb`).then(e=>{e.scene.updateMatrixWorld(!0);let t=new te(e.scene);return t.attributes=[`position`,`normal`],t.useGroups=!1,U=t.generate().center(),Y.generate(U,{targetLeafSize:1})}).then(e=>{H=e,G=new a(U,new o),L.add(G),Q()}),Z(),window.addEventListener(`resize`,function(){I.aspect=window.innerWidth/window.innerHeight,I.updateProjectionMatrix(),F.setSize(window.innerWidth,window.innerHeight)},!1)}function Z(){R&&R.destroy(),P.layer=Math.min(P.resolution,P.layer),R=new E;let e=R.addFolder(`generation`);e.add(P,`gpuGeneration`),e.add(P,`resolution`,10,200,1),e.add(P,`margin`,0,1),e.add(P,`regenerate`);let t=R.addFolder(`display`);t.add(P,`mode`,[`geometry`,`raymarching`,`layer`,`grid layers`]).onChange(()=>{Z()}),P.mode===`layer`&&t.add(P,`layer`,0,P.resolution,1),P.mode===`raymarching`&&t.add(P,`surface`,-.2,.5)}function Q(){let e=P.resolution,t=new n,a=new c,o=new b,l=new c;U.boundingBox.getCenter(a),l.subVectors(U.boundingBox.max,U.boundingBox.min),l.x+=2*P.margin,l.y+=2*P.margin,l.z+=2*P.margin,t.compose(a,o,l),X.copy(t).invert(),B.box.copy(U.boundingBox),B.box.min.x-=P.margin,B.box.min.y-=P.margin,B.box.min.z-=P.margin,B.box.max.x+=P.margin,B.box.max.y+=P.margin,B.box.max.z+=P.margin,W&&W.dispose();let f=1/e,p=.5*f,m=window.performance.now();if(P.gpuGeneration){let n=F.extensions.get(`OES_texture_float_linear`);W=new i(e,e,e),W.texture.format=x,W.texture.type=n?s:g,W.texture.minFilter=h,W.texture.magFilter=h,F.initRenderTarget(W),K.material.uniforms.bvh.value.updateFrom(H),K.material.uniforms.matrix.value.copy(t);let r=new c,a=new u(e,e);a.texture.format=x,a.texture.type=n?s:g;for(let t=0;t<e;t++)K.material.uniforms.zValue.value=t*f+p,F.setRenderTarget(a),K.render(F),r.z=t,F.copyTextureToTexture(a.texture,W.texture,null,r);F.readRenderTargetPixels(a,0,0,1,1,new Float32Array(4)),F.setRenderTarget(null),a.dispose()}else{W=new r(new Float32Array(e**3),e,e,e),W.format=x,W.type=s,W.minFilter=h,W.magFilter=h,W.needsUpdate=!0;let n=new c,i=new d,a={};for(let r=0;r<e;r++)for(let o=0;o<e;o++)for(let s=0;s<e;s++){n.set(p+r*f-.5,p+o*f-.5,p+s*f-.5).applyMatrix4(t);let c=r+o*e+s*e*e,l=H.closestPointToPoint(n,a).distance;i.origin.copy(n),i.direction.set(0,0,1);let u=H.raycastFirst(i,2),d=u&&u.face.normal.dot(i.direction)>0;W.image.data[c]=d?-l:l}}let _=window.performance.now()-m;V.innerText=`${_.toFixed(2)}ms`,Z()}function $(){if(z.update(),requestAnimationFrame($),W){if(P.mode===`geometry`)F.render(L,I);else if(P.mode===`layer`||P.mode===`grid layers`){let e,t=q.material;W.isData3DTexture?(t.uniforms.layer.value=P.layer/W.image.width,t.uniforms.sdfTex.value=W,e=W):(t.uniforms.layer.value=P.layer/W.width,t.uniforms.sdfTex.value=W.texture,e=W.texture),t.uniforms.layers.value=e.image.width;let n=P.mode===`layer`?0:1;n!==t.defines.DISPLAY_GRID&&(t.defines.DISPLAY_GRID=n,t.needsUpdate=!0),q.render(F)}else if(P.mode===`raymarching`){I.updateMatrixWorld(),G.updateMatrixWorld();let e;e=W.isData3DTexture?W:W.texture;let{width:t,depth:n,height:r}=e.image;J.material.uniforms.sdfTex.value=e,J.material.uniforms.normalStep.value.set(1/t,1/r,1/n),J.material.uniforms.surface.value=P.surface,J.material.uniforms.projectionInverse.value.copy(I.projectionMatrixInverse),J.material.uniforms.sdfTransformInverse.value.copy(G.matrixWorld).invert().premultiply(X).multiply(I.matrixWorld),J.render(F)}}}
//# sourceMappingURL=sdfGeneration-BQKG306Y.js.map