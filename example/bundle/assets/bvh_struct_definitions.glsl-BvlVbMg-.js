import{K as A,z as T,at as b,au as _,av as F,aw as z,ax as H,ay as M,az as k,J as w,aA as S,aB as C,aa as U,aC as E,aD as P,B as V}from"./ExtendedTriangle-CdCvQVSB.js";import{g as L,b as G,B,d as Y,f as W,O as q,R as K,h as j,j as X}from"./MeshBVH-BATg3dsp.js";function J(c){switch(c){case 1:return"R";case 2:return"RG";case 3:return"RGBA";case 4:return"RGBA"}throw new Error}function Z(c){switch(c){case 1:return U;case 2:return C;case 3:return w;case 4:return w}}function N(c){switch(c){case 1:return P;case 2:return E;case 3:return S;case 4:return S}}class O extends T{constructor(){super(),this.minFilter=b,this.magFilter=b,this.generateMipmaps=!1,this.overrideItemSize=null,this._forcedType=null}updateFrom(e){const t=this.overrideItemSize,d=e.itemSize,n=e.count;if(t!==null){if(d*n%t!==0)throw new Error("VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.");e.itemSize=t,e.count=n*d/t}const r=e.itemSize,x=e.count,y=e.normalized,l=e.array.constructor,i=l.BYTES_PER_ELEMENT;let v=this._forcedType,f=r;if(v===null)switch(l){case Float32Array:v=A;break;case Uint8Array:case Uint16Array:case Uint32Array:v=_;break;case Int8Array:case Int16Array:case Int32Array:v=F;break}let o,a,u,h,m=J(r);switch(v){case A:u=1,a=Z(r),y&&i===1?(h=l,m+="8",l===Uint8Array?o=z:(o=M,m+="_SNORM")):(h=Float32Array,m+="32F",o=A);break;case F:m+=i*8+"I",u=y?Math.pow(2,l.BYTES_PER_ELEMENT*8-1):1,a=N(r),i===1?(h=Int8Array,o=M):i===2?(h=Int16Array,o=k):(h=Int32Array,o=F);break;case _:m+=i*8+"UI",u=y?Math.pow(2,l.BYTES_PER_ELEMENT*8-1):1,a=N(r),i===1?(h=Uint8Array,o=z):i===2?(h=Uint16Array,o=H):(h=Uint32Array,o=_);break}f===3&&(a===w||a===S)&&(f=4);const s=Math.ceil(Math.sqrt(x))||1,I=f*s*s,p=new h(I),R=e.normalized;e.normalized=!1;for(let g=0;g<x;g++){const D=f*g;p[D]=e.getX(g)/u,r>=2&&(p[D+1]=e.getY(g)/u),r>=3&&(p[D+2]=e.getZ(g)/u,f===4&&(p[D+3]=1)),r>=4&&(p[D+3]=e.getW(g)/u)}e.normalized=R,this.internalFormat=m,this.format=a,this.type=o,this.image.width=s,this.image.height=s,this.image.data=p,this.needsUpdate=!0,this.dispose(),e.itemSize=d,e.count=n}}class Q extends O{constructor(){super(),this._forcedType=_}}class $ extends O{constructor(){super(),this._forcedType=A}}class re{constructor(){this.index=new Q,this.position=new $,this.bvhBounds=new T,this.bvhContents=new T,this._cachedIndexAttr=null,this.index.overrideItemSize=3}updateFrom(e){const{geometry:t}=e;if(te(e,this.bvhBounds,this.bvhContents),this.position.updateFrom(t.attributes.position),e.indirect){const d=e._indirectBuffer;if(this._cachedIndexAttr===null||this._cachedIndexAttr.count!==d.length)if(t.index)this._cachedIndexAttr=t.index.clone();else{const n=L(G(t));this._cachedIndexAttr=new V(n,1,!1)}ee(t,d,this._cachedIndexAttr),this.index.updateFrom(this._cachedIndexAttr)}else this.index.updateFrom(t.index)}dispose(){const{index:e,position:t,bvhBounds:d,bvhContents:n}=this;e&&e.dispose(),t&&t.dispose(),d&&d.dispose(),n&&n.dispose()}}function ee(c,e,t){const d=t.array,n=c.index?c.index.array:null;for(let r=0,x=e.length;r<x;r++){const y=3*r,l=3*e[r];for(let i=0;i<3;i++)d[y+i]=n?n[l+i]:l+i}}function te(c,e,t){const d=c._roots;if(d.length!==1)throw new Error("MeshBVHUniformStruct: Multi-root BVHs not supported.");const n=d[0],r=new Uint16Array(n),x=new Uint32Array(n),y=new Float32Array(n),l=n.byteLength/B,i=2*Math.ceil(Math.sqrt(l/2)),v=new Float32Array(4*i*i),f=Math.ceil(Math.sqrt(l)),o=new Uint32Array(2*f*f);for(let a=0;a<l;a++){const u=a*B/4,h=u*2,m=X(u);for(let s=0;s<3;s++)v[8*a+0+s]=y[m+0+s],v[8*a+4+s]=y[m+3+s];if(Y(h,r)){const s=W(h,r),I=q(u,x),p=4294901760|s;o[a*2+0]=p,o[a*2+1]=I}else{const s=4*K(u,x)/B,I=j(u,x);o[a*2+0]=I,o[a*2+1]=s}}e.image.data=v,e.image.width=i,e.image.height=i,e.format=w,e.type=A,e.internalFormat="RGBA32F",e.minFilter=b,e.magFilter=b,e.generateMipmaps=!1,e.needsUpdate=!0,e.dispose(),t.image.data=o,t.image.width=f,t.image.height=f,t.format=E,t.type=_,t.internalFormat="RG32UI",t.minFilter=b,t.magFilter=b,t.generateMipmaps=!1,t.needsUpdate=!0,t.dispose()}const oe=`

// A stack of uint32 indices can can store the indices for
// a perfectly balanced tree with a depth up to 31. Lower stack
// depth gets higher performance.
//
// However not all trees are balanced. Best value to set this to
// is the trees max depth.
#ifndef BVH_STACK_DEPTH
#define BVH_STACK_DEPTH 60
#endif

#ifndef INFINITY
#define INFINITY 1e20
#endif

// Utilities
uvec4 uTexelFetch1D( usampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

ivec4 iTexelFetch1D( isampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 textureSampleBarycoord( sampler2D tex, vec3 barycoord, uvec3 faceIndices ) {

	return
		barycoord.x * texelFetch1D( tex, faceIndices.x ) +
		barycoord.y * texelFetch1D( tex, faceIndices.y ) +
		barycoord.z * texelFetch1D( tex, faceIndices.z );

}

void ndcToCameraRay(
	vec2 coord, mat4 cameraWorld, mat4 invProjectionMatrix,
	out vec3 rayOrigin, out vec3 rayDirection
) {

	// get camera look direction and near plane for camera clipping
	vec4 lookDirection = cameraWorld * vec4( 0.0, 0.0, - 1.0, 0.0 );
	vec4 nearVector = invProjectionMatrix * vec4( 0.0, 0.0, - 1.0, 1.0 );
	float near = abs( nearVector.z / nearVector.w );

	// get the camera direction and position from camera matrices
	vec4 origin = cameraWorld * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec4 direction = invProjectionMatrix * vec4( coord, 0.5, 1.0 );
	direction /= direction.w;
	direction = cameraWorld * direction - origin;

	// slide the origin along the ray until it sits at the near clip plane position
	origin.xyz += direction.xyz * near / dot( direction, lookDirection );

	rayOrigin = origin.xyz;
	rayDirection = direction.xyz;

}
`,ae=`

#ifndef TRI_INTERSECT_EPSILON
#define TRI_INTERSECT_EPSILON 1e-5
#endif

// Raycasting
bool intersectsBounds( vec3 rayOrigin, vec3 rayDirection, vec3 boundsMin, vec3 boundsMax, out float dist ) {

	// https://www.reddit.com/r/opengl/comments/8ntzz5/fast_glsl_ray_box_intersection/
	// https://tavianator.com/2011/ray_box.html
	vec3 invDir = 1.0 / rayDirection;

	// find intersection distances for each plane
	vec3 tMinPlane = invDir * ( boundsMin - rayOrigin );
	vec3 tMaxPlane = invDir * ( boundsMax - rayOrigin );

	// get the min and max distances from each intersection
	vec3 tMinHit = min( tMaxPlane, tMinPlane );
	vec3 tMaxHit = max( tMaxPlane, tMinPlane );

	// get the furthest hit distance
	vec2 t = max( tMinHit.xx, tMinHit.yz );
	float t0 = max( t.x, t.y );

	// get the minimum hit distance
	t = min( tMaxHit.xx, tMaxHit.yz );
	float t1 = min( t.x, t.y );

	// set distance to 0.0 if the ray starts inside the box
	dist = max( t0, 0.0 );

	return t1 >= dist;

}

bool intersectsTriangle(
	vec3 rayOrigin, vec3 rayDirection, vec3 a, vec3 b, vec3 c,
	out vec3 barycoord, out vec3 norm, out float dist, out float side
) {

	// https://stackoverflow.com/questions/42740765/intersection-between-line-and-triangle-in-3d
	vec3 edge1 = b - a;
	vec3 edge2 = c - a;
	norm = cross( edge1, edge2 );

	float det = - dot( rayDirection, norm );
	float invdet = 1.0 / det;

	vec3 AO = rayOrigin - a;
	vec3 DAO = cross( AO, rayDirection );

	vec4 uvt;
	uvt.x = dot( edge2, DAO ) * invdet;
	uvt.y = - dot( edge1, DAO ) * invdet;
	uvt.z = dot( AO, norm ) * invdet;
	uvt.w = 1.0 - uvt.x - uvt.y;

	// set the hit information
	barycoord = uvt.wxy; // arranged in A, B, C order
	dist = uvt.z;
	side = sign( det );
	norm = side * normalize( norm );

	// add an epsilon to avoid misses between triangles
	uvt += vec4( TRI_INTERSECT_EPSILON );

	return all( greaterThanEqual( uvt, vec4( 0.0 ) ) );

}

bool intersectTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// outputs
	inout float minDistance, inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	bool found = false;
	vec3 localBarycoord, localNormal;
	float localDist, localSide;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		if (
			intersectsTriangle( rayOrigin, rayDirection, a, b, c, localBarycoord, localNormal, localDist, localSide )
			&& localDist < minDistance
		) {

			found = true;
			minDistance = localDist;

			faceIndices = uvec4( indices.xyz, i );
			faceNormal = localNormal;

			side = localSide;
			barycoord = localBarycoord;
			dist = localDist;

		}

	}

	return found;

}

bool intersectsBVHNodeBounds( vec3 rayOrigin, vec3 rayDirection, sampler2D bvhBounds, uint currNodeIndex, out float dist ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return intersectsBounds( rayOrigin, rayDirection, boundsMin, boundsMax, dist );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhIntersectFirstHit(		bvh,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)	_bvhIntersectFirstHit(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)

bool _bvhIntersectFirstHit(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// output variables split into separate variables due to output precision
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float triangleDistance = INFINITY;
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance;
		if (
			! intersectsBVHNodeBounds( rayOrigin, rayDirection, bvh_bvhBounds, currNodeIndex, boundsHitDistance )
			|| boundsHitDistance > triangleDistance
		) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;

			found = intersectTriangles(
				bvh_position, bvh_index, offset, count,
				rayOrigin, rayDirection, triangleDistance,
				faceIndices, faceNormal, barycoord, side, dist
			) || found;

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = boundsInfo.y;

			bool leftToRight = rayDirection[ splitAxis ] >= 0.0;
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

	return found;

}
`,se=`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};
`;export{$ as F,re as M,ae as a,se as b,oe as c};
