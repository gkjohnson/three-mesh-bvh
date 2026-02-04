import{W as c,T as d,a as l,R as u,F as v,H as f,L as a,S as h}from"./ExtendedTriangle-hsPasuNU.js";import{F as x}from"./Pass-BOKrxmL7.js";import{M as b}from"./MeshBVH-DQV6PBDm.js";import{M as m}from"./MeshBVHUniformStruct-5h9E4Xx4.js";class p extends h{constructor(n){super({uniforms:{bvh:{value:new m}},vertexShader:`

				void main() {

					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`

				precision highp isampler2D;
				precision highp usampler2D;

				/* common_functions.glsl.js */

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

				vec4 texelFetch1D( sampler2D tex, uint index ) {

					uint width = uint( textureSize( tex, 0 ).x );
					uvec2 uv;
					uv.x = index % width;
					uv.y = index / width;

					return texelFetch( tex, ivec2( uv ), 0 );

				}

				/* bvh_struct_definitions.glsl.js */
				struct BVH {

					usampler2D index;
					sampler2D position;

					sampler2D bvhBounds;
					usampler2D bvhContents;

				};

				/* bvh_ray_functions.glsl.js */
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

				/* main */
				uniform BVH bvh;
				void main() {

					// compute the point in space to check
					vec3 point = vec3( 0.0 );
					uvec4 faceIndices;
					vec3 faceNormal;
					vec3 barycoord;
					float side;
					float rayDist;

					side = 1.0;
					_bvhIntersectFirstHit(
						bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,
						point.xyz, vec3( 0, 0, 1 ), faceIndices, faceNormal, barycoord, side, rayDist
					);

					// if the triangle side is the back then it must be on the inside and the value negative
					gl_FragColor = vec4( side, 0, 0, 0 );

				}

			`}),this.setValues(n)}}const g={resolution:75};let e,s,i,r;y();function y(){e=new c({antialias:!0}),e.setPixelRatio(window.devicePixelRatio),e.setSize(window.innerWidth,window.innerHeight),document.body.appendChild(e.domElement),r=new x(new p);const t=new d(1,.4,1e3,500);s=new b(t,{maxLeafSize:1}),D()}function D(){const t=g.resolution,n=e.extensions.get("OES_texture_float_linear");i=new l(t,t,t),i.texture.format=u,i.texture.type=n?v:f,i.texture.minFilter=a,i.texture.magFilter=a,r.material.uniforms.bvh.value.updateFrom(s);for(let o=0;o<t;o++)e.setRenderTarget(i,o),r.render(e);e.readRenderTargetPixels(i,0,0,1,1,new Float32Array(4)),e.setRenderTarget(null),console.log("DONE")}
//# sourceMappingURL=3dtex_repro-C9_1bMBl.js.map
