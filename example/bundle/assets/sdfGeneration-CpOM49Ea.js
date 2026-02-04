import{S as A,n as b,V as y,W as Y,c as $,D as Q,A as K,P as X,aQ as J,b as Z,M as ee,g as te,af as oe,a as ne,R as B,F as M,H as L,L as S,aa as ie,aR as re,Y as ae,t as se}from"./ExtendedTriangle-hsPasuNU.js";import{G as ce}from"./GLTFLoader-Be-eETKy.js";import{F}from"./Pass-BOKrxmL7.js";import{O as de}from"./OrbitControls-DEZHvbFX.js";import{g as le}from"./lil-gui.module.min-BH_YJbPT.js";import{S as ue}from"./stats.min-DbzWzcqd.js";import{c as ve,b as fe,a as me}from"./bvh_struct_definitions.glsl-kQBCFuAP.js";import{M as pe}from"./MeshBVHUniformStruct-5h9E4Xx4.js";import{M as xe}from"./meshopt_decoder.module-j6OW_3Rk.js";import{G as he}from"./GenerateMeshBVHWorker-vOgOjCfJ.js";import{S as ye}from"./StaticGeometryGenerator-QNaaaoUl.js";import"./BufferGeometryUtils-BuPYlHUL.js";import"./_commonjsHelpers-CqkleIqs.js";import"./MeshBVH-DQV6PBDm.js";const ge=`

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
`;class be extends A{constructor(o){super({defines:{USE_SHADER_RAYCAST:window.location.hash.includes("USE_SHADER_RAYCAST")?1:0},uniforms:{matrix:{value:new b},zValue:{value:0},bvh:{value:new pe}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`

				precision highp isampler2D;
				precision highp usampler2D;

				${ve}
				${fe}
				${me}
				${ge}

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

			`}),this.setValues(o)}}class we extends A{constructor(o){super({defines:{DISPLAY_GRID:0},uniforms:{sdfTex:{value:null},layer:{value:0},layers:{value:0}},vertexShader:`

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
			`}),this.setValues(o)}}class De extends A{constructor(o){super({defines:{MAX_STEPS:500,SURFACE_EPSILON:.001},uniforms:{surface:{value:0},sdfTex:{value:null},normalStep:{value:new y},projectionInverse:{value:new b},sdfTransformInverse:{value:new b}},vertexShader:`

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
			`}),this.setValues(o)}}const t={gpuGeneration:!0,resolution:75,margin:.2,regenerate:()=>G(),mode:"raymarching",layer:0,surface:.1};let i,a,m,h,z,c,U,I,v,n,P,g,R,u,N;const V=new b;Te();k();function Te(){U=document.getElementById("output"),i=new Y({antialias:!0}),i.setPixelRatio(window.devicePixelRatio),i.setSize(window.innerWidth,window.innerHeight),i.setClearColor(0,0),document.body.appendChild(i.domElement),m=new $;const e=new Q(16777215,1);e.position.set(1,1,1),m.add(e),m.add(new K(16777215,.2)),a=new X(75,window.innerWidth/window.innerHeight,.1,50),a.position.set(1,1,2),a.far=100,a.updateProjectionMatrix(),c=new J(new Z),m.add(c),new de(a,i.domElement),z=new ue,document.body.appendChild(z.dom),g=new F(new be),R=new F(new we),u=new F(new De),N=new he,new ce().setMeshoptDecoder(xe).loadAsync("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb").then(o=>{o.scene.updateMatrixWorld(!0);const r=new ye(o.scene);return r.attributes=["position","normal"],r.useGroups=!1,v=r.generate().center(),N.generate(v,{maxLeafSize:1})}).then(o=>{I=o,P=new ee(v,new te),m.add(P),G()}),C(),window.addEventListener("resize",function(){a.aspect=window.innerWidth/window.innerHeight,a.updateProjectionMatrix(),i.setSize(window.innerWidth,window.innerHeight)},!1)}function C(){h&&h.destroy(),t.layer=Math.min(t.resolution,t.layer),h=new le;const e=h.addFolder("generation");e.add(t,"gpuGeneration"),e.add(t,"resolution",10,200,1),e.add(t,"margin",0,1),e.add(t,"regenerate");const o=h.addFolder("display");o.add(t,"mode",["geometry","raymarching","layer","grid layers"]).onChange(()=>{C()}),t.mode==="layer"&&o.add(t,"layer",0,t.resolution,1),t.mode==="raymarching"&&o.add(t,"surface",-.2,.5)}function G(){const e=t.resolution,o=new b,r=new y,_=new oe,p=new y;v.boundingBox.getCenter(r),p.subVectors(v.boundingBox.max,v.boundingBox.min),p.x+=2*t.margin,p.y+=2*t.margin,p.z+=2*t.margin,o.compose(r,_,p),V.copy(o).invert(),c.box.copy(v.boundingBox),c.box.min.x-=t.margin,c.box.min.y-=t.margin,c.box.min.z-=t.margin,c.box.max.x+=t.margin,c.box.max.y+=t.margin,c.box.max.z+=t.margin,n&&n.dispose();const x=1/e,w=.5*x,E=window.performance.now();if(t.gpuGeneration){const f=i.extensions.get("OES_texture_float_linear");n=new ne(e,e,e),n.texture.format=B,n.texture.type=f?M:L,n.texture.minFilter=S,n.texture.magFilter=S,i.initRenderTarget(n),g.material.uniforms.bvh.value.updateFrom(I),g.material.uniforms.matrix.value.copy(o);const l=new y,d=new ie(e,e);d.texture.format=B,d.texture.type=f?M:L;for(let s=0;s<e;s++)g.material.uniforms.zValue.value=s*x+w,i.setRenderTarget(d),g.render(i),l.z=s,i.copyTextureToTexture(d.texture,n.texture,null,l);i.readRenderTargetPixels(d,0,0,1,1,new Float32Array(4)),i.setRenderTarget(null),d.dispose()}else{n=new re(new Float32Array(e**3),e,e,e),n.format=B,n.type=M,n.minFilter=S,n.magFilter=S,n.needsUpdate=!0;const f=new y,l=new ae,d={};for(let s=0;s<e;s++)for(let D=0;D<e;D++)for(let T=0;T<e;T++){f.set(w+s*x-.5,w+D*x-.5,w+T*x-.5).applyMatrix4(o);const O=s+D*e+T*e*e,q=I.closestPointToPoint(f,d).distance;l.origin.copy(f),l.direction.set(0,0,1);const H=I.raycastFirst(l,se),j=H&&H.face.normal.dot(l.direction)>0;n.image.data[O]=j?-q:q}}const W=window.performance.now()-E;U.innerText=`${W.toFixed(2)}ms`,C()}function k(){if(z.update(),requestAnimationFrame(k),n){if(t.mode==="geometry")i.render(m,a);else if(t.mode==="layer"||t.mode==="grid layers"){let e;const o=R.material;n.isData3DTexture?(o.uniforms.layer.value=t.layer/n.image.width,o.uniforms.sdfTex.value=n,e=n):(o.uniforms.layer.value=t.layer/n.width,o.uniforms.sdfTex.value=n.texture,e=n.texture),o.uniforms.layers.value=e.image.width;const r=t.mode==="layer"?0:1;r!==o.defines.DISPLAY_GRID&&(o.defines.DISPLAY_GRID=r,o.needsUpdate=!0),R.render(i)}else if(t.mode==="raymarching"){a.updateMatrixWorld(),P.updateMatrixWorld();let e;n.isData3DTexture?e=n:e=n.texture;const{width:o,depth:r,height:_}=e.image;u.material.uniforms.sdfTex.value=e,u.material.uniforms.normalStep.value.set(1/o,1/_,1/r),u.material.uniforms.surface.value=t.surface,u.material.uniforms.projectionInverse.value.copy(a.projectionMatrixInverse),u.material.uniforms.sdfTransformInverse.value.copy(P.matrixWorld).invert().premultiply(V).multiply(a.matrixWorld),u.render(i)}}else return}
//# sourceMappingURL=sdfGeneration-CpOM49Ea.js.map
