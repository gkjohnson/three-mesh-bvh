import{a1 as C,f as h,V as u,W as J,s as Z,S as ee,D as te,A as oe,P as ne,ap as ie,a as re,M as ae,d as se,aq as ce,aa as k,K as L,Q as de,Y as T,ar as le,v as ue,as as ve}from"./ExtendedTriangle-CdCvQVSB.js";import{G as fe}from"./GLTFLoader-CKopl1HH.js";import{F as M}from"./Pass-BfbAPnNm.js";import{O as me}from"./OrbitControls-iAm09Il8.js";import{g as pe}from"./lil-gui.module.min-Bc0DeA9g.js";import{S as xe}from"./stats.min-GTpOrGrX.js";import{G as he}from"./GenerateMeshBVHWorker-BHgoKe3g.js";import{M as ge,c as be,b as ye,a as we}from"./bvh_struct_definitions.glsl-DwALRlLp.js";import{M as Te}from"./meshopt_decoder.module-Cf1-17OU.js";import{S as De}from"./StaticGeometryGenerator-RJrMPGpb.js";import"./BufferGeometryUtils-ChJfj-2T.js";import"./_commonjsHelpers-Cpj98o6Y.js";import"./MeshBVH-bmQbDysG.js";const Se=`

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
		u = 1.0-v;

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
#define	bvhClosestPointToPoint(		bvh,		point, faceIndices, faceNormal, barycoord, side, outPoint	)	_bvhClosestPointToPoint(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		point, faceIndices, faceNormal, barycoord, side, outPoint	)

float _bvhClosestPointToPoint(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// point to check
	vec3 point,

	// output variables
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout vec3 outPoint
 ) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float closestDistanceSquared = pow( 100000.0, 2.0 );
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

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
			uint rightIndex = boundsInfo.y;
			bool leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, rightIndex );//rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;
			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return sqrt( closestDistanceSquared );

}
`;class Ie extends C{constructor(o){super({uniforms:{matrix:{value:new h},zValue:{value:0},bvh:{value:new ge}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`

				precision highp isampler2D;
				precision highp usampler2D;

				${be}
				${ye}
				${we}
				${Se}

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
					vec3 outPoint;
					float dist = bvhClosestPointToPoint( bvh, point.xyz, faceIndices, faceNormal, barycoord, side, outPoint );

					// if the triangle side is the back then it must be on the inside and the value negative
					gl_FragColor = vec4( side * dist, 0, 0, 0 );

				}

			`}),this.setValues(o)}}class Pe extends C{constructor(o){super({defines:{DISPLAY_GRID:0},uniforms:{sdfTex:{value:null},layer:{value:0},layers:{value:0}},vertexShader:`

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

					#include <encodings_fragment>

				}
			`}),this.setValues(o)}}class Be extends C{constructor(o){super({defines:{MAX_STEPS:500,SURFACE_EPSILON:.001},uniforms:{surface:{value:0},sdfTex:{value:null},normalStep:{value:new u},projectionInverse:{value:new h},sdfTransformInverse:{value:new h}},vertexShader:`

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
							float distanceToSurface = texture2D( sdfTex, uv ).r - surface;
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

					#include <encodings_fragment>

				}
			`}),this.setValues(o)}}const t={gpuGeneration:!0,resolution:75,margin:.2,regenerate:()=>E(),mode:"raymarching",layer:0,surface:.1};let i,a,v,p,F,s,U,z,c,n,D,x,A,l,H;const W=new h;_e();O();function _e(){U=document.getElementById("output"),i=new J({antialias:!0}),i.setPixelRatio(window.devicePixelRatio),i.setSize(window.innerWidth,window.innerHeight),i.setClearColor(0,0),i.outputEncoding=Z,document.body.appendChild(i.domElement),v=new ee;const e=new te(16777215,1);e.position.set(1,1,1),v.add(e),v.add(new oe(16777215,.2)),a=new ne(75,window.innerWidth/window.innerHeight,.1,50),a.position.set(1,1,2),a.far=100,a.updateProjectionMatrix(),s=new ie(new re),v.add(s),new me(a,i.domElement),F=new xe,document.body.appendChild(F.dom),x=new M(new Ie),A=new M(new Pe),l=new M(new Be),H=new he,new fe().setMeshoptDecoder(Te).loadAsync("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb").then(o=>{o.scene.updateMatrixWorld(!0);const r=new De(o.scene);return r.attributes=["position","normal"],r.useGroups=!1,c=r.generate().center(),H.generate(c,{maxLeafTris:1})}).then(o=>{z=o,D=new ae(c,new se),v.add(D),E()}),q(),window.addEventListener("resize",function(){a.aspect=window.innerWidth/window.innerHeight,a.updateProjectionMatrix(),i.setSize(window.innerWidth,window.innerHeight)},!1)}function q(){p&&p.destroy(),t.layer=Math.min(t.resolution,t.layer),p=new pe;const e=p.addFolder("generation");e.add(t,"gpuGeneration"),e.add(t,"resolution",10,200,1),e.add(t,"margin",0,1),e.add(t,"regenerate");const o=p.addFolder("display");o.add(t,"mode",["geometry","raymarching","layer","grid layers"]).onChange(()=>{q()}),t.mode==="layer"&&o.add(t,"layer",0,t.resolution,1),t.mode==="raymarching"&&o.add(t,"surface",-.2,.5)}function E(){const e=t.resolution,o=new h,r=new u,S=new ve,f=new u;c.boundingBox.getCenter(r),f.subVectors(c.boundingBox.max,c.boundingBox.min),f.x+=2*t.margin,f.y+=2*t.margin,f.z+=2*t.margin,o.compose(r,S,f),W.copy(o).invert(),s.box.copy(c.boundingBox),s.box.min.x-=t.margin,s.box.min.y-=t.margin,s.box.min.z-=t.margin,s.box.max.x+=t.margin,s.box.max.y+=t.margin,s.box.max.z+=t.margin,n&&n.dispose();const m=1/e,g=.5*m,j=window.performance.now();if(t.gpuGeneration){const I=i.extensions.get("OES_texture_float_linear");n=new ce(e,e,e),n.texture.format=k,n.texture.type=I?L:de,n.texture.minFilter=T,n.texture.magFilter=T,x.material.uniforms.bvh.value.updateFrom(z),x.material.uniforms.matrix.value.copy(o);for(let d=0;d<e;d++)x.material.uniforms.zValue.value=d*m+g,i.setRenderTarget(n,d),x.render(i);i.readRenderTargetPixels(n,0,0,1,1,new Float32Array(4)),i.setRenderTarget(null)}else{n=new le(new Float32Array(e**3),e,e,e),n.format=k,n.type=L,n.minFilter=T,n.magFilter=T,n.needsUpdate=!0;const I=c.attributes.position,d=c.index,P=new u,R=new u,V=new u,G=new ue,B={};for(let b=0;b<e;b++)for(let y=0;y<e;y++)for(let w=0;w<e;w++){P.set(g+b*m-.5,g+y*m-.5,g+w*m-.5).applyMatrix4(o);const Y=b+y*e+w*e*e,N=z.closestPointToPoint(P,B).distance,_=B.faceIndex,$=d.getX(_*3+0),K=d.getX(_*3+1),Q=d.getX(_*3+2);G.setFromAttributeAndIndices(I,$,K,Q),G.getNormal(R),V.subVectors(B.point,P),n.image.data[Y]=R.dot(V)>0?-N:N}}const X=window.performance.now()-j;U.innerText=`${X.toFixed(2)}ms`,q()}function O(){if(F.update(),requestAnimationFrame(O),n){if(t.mode==="geometry")i.render(v,a);else if(t.mode==="layer"||t.mode==="grid layers"){let e;const o=A.material;n.isData3DTexture?(o.uniforms.layer.value=t.layer/n.image.width,o.uniforms.sdfTex.value=n,e=n):(o.uniforms.layer.value=t.layer/n.width,o.uniforms.sdfTex.value=n.texture,e=n.texture),o.uniforms.layers.value=e.image.width;const r=t.mode==="layer"?0:1;r!==o.defines.DISPLAY_GRID&&(o.defines.DISPLAY_GRID=r,o.needsUpdate=!0),A.render(i)}else if(t.mode==="raymarching"){a.updateMatrixWorld(),D.updateMatrixWorld();let e;n.isData3DTexture?e=n:e=n.texture;const{width:o,depth:r,height:S}=e.image;l.material.uniforms.sdfTex.value=e,l.material.uniforms.normalStep.value.set(1/o,1/S,1/r),l.material.uniforms.surface.value=t.surface,l.material.uniforms.projectionInverse.value.copy(a.projectionMatrixInverse),l.material.uniforms.sdfTransformInverse.value.copy(D.matrixWorld).invert().premultiply(W).multiply(a.matrixWorld),l.render(i)}}else return}
