import{F as e,I as t,Jr as n,Nt as r,S as i,Ut as a,Y as o,_r as s,gr as c,i as l,jt as u,kt as d,nt as f,on as p,x as m}from"./ExtendedTriangle-DOKLf4jx.js";import{t as h}from"./MeshBVH-C4U8FvwO.js";import{t as g}from"./MeshBVHUniformStruct-BCaighWg.js";import{n as _,r as v,t as y}from"./bvh_struct_definitions.glsl-D-uzwxra.js";import{t as b}from"./lil-gui.module.min-CCk8J1jY.js";import{t as x}from"./GLTFLoader-p6qoQbZ1.js";import{t as S}from"./OrbitControls-BX2ddTIw.js";import{t as C}from"./stats.module-BDErWxYO.js";var w=class extends e{constructor(e){super(e),this.type=f}parse(e){let n=function(e,t){switch(e){case 1:throw Error(`THREE.HDRLoader: Read Error: `+(t||``));case 2:throw Error(`THREE.HDRLoader: Write Error: `+(t||``));case 3:throw Error(`THREE.HDRLoader: Bad File Format: `+(t||``));default:case 4:throw Error(`THREE.HDRLoader: Memory Error: `+(t||``))}},i=function(e,t,n){t||=1024;let r=e.pos,i=-1,a=0,o=``,s=String.fromCharCode.apply(null,new Uint16Array(e.subarray(r,r+128)));for(;0>(i=s.indexOf(`
`))&&a<t&&r<e.byteLength;)o+=s,a+=s.length,r+=128,s=String.fromCharCode.apply(null,new Uint16Array(e.subarray(r,r+128)));return-1<i?(!1!==n&&(e.pos+=a+i+1),o+s.slice(0,i)):!1},a=function(e){let t=/^#\?(\S+)/,r=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,a=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,o=/^\s*FORMAT=(\S+)\s*$/,s=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,c={valid:0,string:``,comments:``,programtype:`RGBE`,format:``,gamma:1,exposure:1,width:0,height:0},l,u;for((e.pos>=e.byteLength||!(l=i(e)))&&n(1,`no header found`),(u=l.match(t))||n(3,`bad initial token`),c.valid|=1,c.programtype=u[1],c.string+=l+`
`;l=i(e),!1!==l;){if(c.string+=l+`
`,l.charAt(0)===`#`){c.comments+=l+`
`;continue}if((u=l.match(r))&&(c.gamma=parseFloat(u[1])),(u=l.match(a))&&(c.exposure=parseFloat(u[1])),(u=l.match(o))&&(c.valid|=2,c.format=u[1]),(u=l.match(s))&&(c.valid|=4,c.height=parseInt(u[1],10),c.width=parseInt(u[2],10)),c.valid&2&&c.valid&4)break}return c.valid&2||n(3,`missing format specifier`),c.valid&4||n(3,`missing image size specifier`),c},s=function(e,t,r){let i=t;if(i<8||i>32767||e[0]!==2||e[1]!==2||e[2]&128)return new Uint8Array(e);i!==(e[2]<<8|e[3])&&n(3,`wrong scanline width`);let a=new Uint8Array(4*t*r);a.length||n(4,`unable to allocate buffer space`);let o=0,s=0,c=4*i,l=new Uint8Array(4),u=new Uint8Array(c),d=r;for(;d>0&&s<e.byteLength;){s+4>e.byteLength&&n(1),l[0]=e[s++],l[1]=e[s++],l[2]=e[s++],l[3]=e[s++],(l[0]!=2||l[1]!=2||(l[2]<<8|l[3])!=i)&&n(3,`bad rgbe scanline format`);let t=0,r;for(;t<c&&s<e.byteLength;){r=e[s++];let i=r>128;if(i&&(r-=128),(r===0||t+r>c)&&n(3,`bad scanline data`),i){let n=e[s++];for(let e=0;e<r;e++)u[t++]=n}else u.set(e.subarray(s,s+r),t),t+=r,s+=r}let f=i;for(let e=0;e<f;e++){let t=0;a[o]=u[e+t],t+=i,a[o+1]=u[e+t],t+=i,a[o+2]=u[e+t],t+=i,a[o+3]=u[e+t],o+=4}d--}return a},c=function(e,t,n,r){let i=2**(e[t+3]-128)/255;n[r+0]=e[t+0]*i,n[r+1]=e[t+1]*i,n[r+2]=e[t+2]*i,n[r+3]=1},l=function(e,n,r,i){let a=2**(e[n+3]-128)/255;r[i+0]=t.toHalfFloat(Math.min(e[n+0]*a,65504)),r[i+1]=t.toHalfFloat(Math.min(e[n+1]*a,65504)),r[i+2]=t.toHalfFloat(Math.min(e[n+2]*a,65504)),r[i+3]=t.toHalfFloat(1)},u=new Uint8Array(e);u.pos=0;let p=a(u),m=p.width,h=p.height,g=s(u.subarray(u.pos),m,h),_,v,y;switch(this.type){case o:y=g.length/4;let e=new Float32Array(y*4);for(let t=0;t<y;t++)c(g,t*4,e,t*4);_=e,v=o;break;case f:y=g.length/4;let t=new Uint16Array(y*4);for(let e=0;e<y;e++)l(g,e*4,t,e*4);_=t,v=f;break;default:throw Error(`THREE.HDRLoader: Unsupported type: `+this.type)}return{width:m,height:h,data:_,header:p.string,gamma:p.gamma,exposure:p.exposure,type:v,colorSpace:r,minFilter:d,magFilter:d,generateMipmaps:!1,flipY:!0}}setDataType(e){return this.type=e,this}},T=class extends w{constructor(e){console.warn(`RGBELoader has been deprecated. Please use HDRLoader instead.`),super(e)}},E,D,O,k,A,j,M,N,P,F={color:`#ffffff`,bounces:3,ior:2.4,aberrationStrength:.01,fastChroma:!1,animate:!0};I();async function I(){E=new c,D=new p(75,window.innerWidth/window.innerHeight,.1,1e3),D.position.set(28,15,7),O=new l({antialias:!1}),O.setSize(window.innerWidth,window.innerHeight),O.toneMapping=4,O.setAnimationLoop(L),document.body.appendChild(O.domElement),A=new S(D,O.domElement),P=new m;let e=new T().loadAsync(`https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr`),t=new x().loadAsync(`https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/diamond/diamond.glb`),r;[k,r]=await Promise.all([e,t]),k.mapping=303,k.generateMipmaps=!0,k.minFilter=u,k.magFilter=d,E.background=k;let o=new s({uniforms:{envMap:{value:k},bvh:{value:new g},projectionMatrixInv:{value:D.projectionMatrixInverse},viewMatrixInv:{value:D.matrixWorld},resolution:{value:new n},bounces:{value:3},ior:{value:2.4},color:{value:new i(1,1,1)},fastChroma:{value:!1},aberrationStrength:{value:.01}},vertexShader:`
			varying vec3 vWorldPosition;
			varying vec3 vNormal;
			uniform mat4 viewMatrixInv;
			void main() {

				vWorldPosition = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
				vNormal = ( viewMatrixInv * vec4( normalMatrix * normal, 0.0 ) ).xyz;
				gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4( position , 1.0 );

			}
		`,fragmentShader:`
			#define RAY_OFFSET 0.001

			#include <common>
			precision highp isampler2D;
			precision highp usampler2D;

			${v}
			${y}
			${_}

			varying vec3 vWorldPosition;
			varying vec3 vNormal;

			uniform sampler2D envMap;
			uniform float bounces;
			uniform BVH bvh;
			uniform float ior;
			uniform vec3 color;
			uniform bool fastChroma;
			uniform mat4 projectionMatrixInv;
			uniform mat4 viewMatrixInv;
			uniform mat4 modelMatrix;
			uniform vec2 resolution;
			uniform float aberrationStrength;

			#include <cube_uv_reflection_fragment>

			// performs an iterative bounce lookup modeling internal reflection and returns
			// a final ray direction.
			vec3 totalInternalReflection( vec3 incomingOrigin, vec3 incomingDirection, vec3 normal, float ior, mat4 modelMatrixInverse ) {

				vec3 rayOrigin = incomingOrigin;
				vec3 rayDirection = incomingDirection;

				// refract the ray direction on the way into the diamond and adjust offset from
				// the diamond surface for raytracing
				rayDirection = refract( rayDirection, normal, 1.0 / ior );
				rayOrigin = vWorldPosition + rayDirection * RAY_OFFSET;

				// transform the ray into the local coordinates of the model
				rayOrigin = ( modelMatrixInverse * vec4( rayOrigin, 1.0 ) ).xyz;
				rayDirection = normalize( ( modelMatrixInverse * vec4( rayDirection, 0.0 ) ).xyz );

				// perform multiple ray casts
				for( float i = 0.0; i < bounces; i ++ ) {

					// results
					uvec4 faceIndices = uvec4( 0u );
					vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
					vec3 barycoord = vec3( 0.0 );
					float side = 1.0;
					float dist = 0.0;

					// perform the raycast
					// the diamond is a water tight model so we assume we always hit a surface
					bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );

					// derive the new ray origin from the hit results
					vec3 hitPos = rayOrigin + rayDirection * dist;

					// if we don't internally reflect then end the ray tracing and sample
					vec3 refractedDirection = refract( rayDirection, faceNormal, ior );
					bool totalInternalReflection = length( refract( rayDirection, faceNormal, ior ) ) == 0.0;
					if ( ! totalInternalReflection ) {

						rayDirection = refractedDirection;
						break;

					}

					// otherwise reflect off the surface internally for another hit
					rayDirection = reflect( rayDirection, faceNormal );
					rayOrigin = hitPos + rayDirection * RAY_OFFSET;

				}

				// return the final ray direction in world space
				return normalize( ( modelMatrix * vec4( rayDirection, 0.0 ) ).xyz );
			}

			vec4 envSample( sampler2D envMap, vec3 rayDirection ) {

				vec2 uvv = equirectUv( rayDirection );
				return texture( envMap, uvv );

			}

			void main() {

				mat4 modelMatrixInverse = inverse( modelMatrix );
				vec2 uv = gl_FragCoord.xy / resolution;

				vec3 normal = vNormal;
				vec3 rayOrigin = cameraPosition;
				vec3 rayDirection = normalize( vWorldPosition - cameraPosition );

				if ( aberrationStrength != 0.0 ) {

					// perform chromatic aberration lookups
					vec3 rayDirectionG = totalInternalReflection( rayOrigin, rayDirection, normal, max( ior, 1.0 ), modelMatrixInverse );
					vec3 rayDirectionR, rayDirectionB;

					if ( fastChroma ) {

						// fast chroma does a quick uv offset on lookup
						rayDirectionR = normalize( rayDirectionG + 1.0 * vec3( aberrationStrength / 2.0 ) );
						rayDirectionB = normalize( rayDirectionG - 1.0 * vec3( aberrationStrength / 2.0 ) );

					} else {

						// compared to a proper ray trace of diffracted rays
						float iorR = max( ior * ( 1.0 - aberrationStrength ), 1.0 );
						float iorB = max( ior * ( 1.0 + aberrationStrength ), 1.0 );
						rayDirectionR = totalInternalReflection(
							rayOrigin, rayDirection, normal,
							iorR, modelMatrixInverse
						);
						rayDirectionB = totalInternalReflection(
							rayOrigin, rayDirection, normal,
							iorB, modelMatrixInverse
						);

					}

					// get the color lookup
					float r = envSample( envMap, rayDirectionR ).r;
					float g = envSample( envMap, rayDirectionG ).g;
					float b = envSample( envMap, rayDirectionB ).b;
					gl_FragColor.rgb = vec3( r, g, b ) * color;
					gl_FragColor.a = 1.0;

				} else {

					// no chromatic aberration lookups
					rayDirection = totalInternalReflection( rayOrigin, rayDirection, normal, max( ior, 1.0 ), modelMatrixInverse );
					gl_FragColor.rgb = envSample( envMap, rayDirection ).rgb * color;
					gl_FragColor.a = 1.0;

				}

				#include <tonemapping_fragment>
				#include <colorspace_fragment>

			}
		`}),f=r.scene.children[0].children[0].children[0].children[0].children[0].geometry;f.scale(10,10,10);let w=new h(f,{strategy:2,targetLeafSize:1});o.uniforms.bvh.value.updateFrom(w),j=new a(f,o),E.add(j),M=new b,M.add(F,`animate`),M.addColor(F,`color`).name(`Color`).onChange(e=>{j.material.uniforms.color.value.set(e)}),M.add(F,`bounces`,1,10,1).name(`Bounces`).onChange(e=>{j.material.uniforms.bounces.value=e}),M.add(F,`ior`,1,5,.01).name(`IOR`).onChange(e=>{j.material.uniforms.ior.value=e}),M.add(F,`fastChroma`).onChange(e=>{j.material.uniforms.fastChroma.value=e}),M.add(F,`aberrationStrength`,0,.1,1e-4).onChange(e=>{j.material.uniforms.aberrationStrength.value=e}),N=new C,N.showPanel(0),document.body.appendChild(N.dom),window.addEventListener(`resize`,function(){D.aspect=window.innerWidth/window.innerHeight,D.updateProjectionMatrix(),j.material.uniforms.resolution.value.set(window.innerWidth,window.innerHeight),O.setSize(window.innerWidth,window.innerHeight)},!1)}function L(){j&&(F.animate&&(j.rotation.y+=P.getDelta()*.25),N.update(),A.update(),O.render(E,D))}
//# sourceMappingURL=diamond-BaKrffRd.js.map