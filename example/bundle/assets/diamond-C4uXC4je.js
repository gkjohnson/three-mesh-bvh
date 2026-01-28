import{a1 as Q,H as B,F as H,a2 as G,a3 as Z,L as P,c as ee,P as re,W as ae,a4 as oe,a5 as ie,a6 as ne,S as te,C as le,J as ce,M as se,h as me}from"./ExtendedTriangle-hsPasuNU.js";import{g as de}from"./lil-gui.module.min-BH_YJbPT.js";import{O as he}from"./OrbitControls-DEZHvbFX.js";import{G as ge}from"./GLTFLoader-Be-eETKy.js";import{S as fe}from"./stats.module--VATS4Kh.js";import{M as ve,S as pe}from"./MeshBVH-DQV6PBDm.js";import{c as ue,b as ye,a as _e}from"./bvh_struct_definitions.glsl-kQBCFuAP.js";import{M as we}from"./MeshBVHUniformStruct-5h9E4Xx4.js";import"./BufferGeometryUtils-BuPYlHUL.js";class be extends Q{constructor(d){super(d),this.type=B}parse(d){const a=function(e,o){switch(e){case 1:throw new Error("THREE.RGBELoader: Read Error: "+(o||""));case 2:throw new Error("THREE.RGBELoader: Write Error: "+(o||""));case 3:throw new Error("THREE.RGBELoader: Bad File Format: "+(o||""));default:case 4:throw new Error("THREE.RGBELoader: Memory Error: "+(o||""))}},O=function(e,o,n){o=o||1024;let c=e.pos,l=-1,r=0,s="",i=String.fromCharCode.apply(null,new Uint16Array(e.subarray(c,c+128)));for(;0>(l=i.indexOf(`
`))&&r<o&&c<e.byteLength;)s+=i,r+=i.length,c+=128,i+=String.fromCharCode.apply(null,new Uint16Array(e.subarray(c,c+128)));return-1<l?(e.pos+=r+l+1,s+i.slice(0,l)):!1},$=function(e){const o=/^#\?(\S+)/,n=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,t=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,c=/^\s*FORMAT=(\S+)\s*$/,l=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,r={valid:0,string:"",comments:"",programtype:"RGBE",format:"",gamma:1,exposure:1,width:0,height:0};let s,i;for((e.pos>=e.byteLength||!(s=O(e)))&&a(1,"no header found"),(i=s.match(o))||a(3,"bad initial token"),r.valid|=1,r.programtype=i[1],r.string+=s+`
`;s=O(e),s!==!1;){if(r.string+=s+`
`,s.charAt(0)==="#"){r.comments+=s+`
`;continue}if((i=s.match(n))&&(r.gamma=parseFloat(i[1])),(i=s.match(t))&&(r.exposure=parseFloat(i[1])),(i=s.match(c))&&(r.valid|=2,r.format=i[1]),(i=s.match(l))&&(r.valid|=4,r.height=parseInt(i[1],10),r.width=parseInt(i[2],10)),r.valid&2&&r.valid&4)break}return r.valid&2||a(3,"missing format specifier"),r.valid&4||a(3,"missing image size specifier"),r},q=function(e,o,n){const t=o;if(t<8||t>32767||e[0]!==2||e[1]!==2||e[2]&128)return new Uint8Array(e);t!==(e[2]<<8|e[3])&&a(3,"wrong scanline width");const c=new Uint8Array(4*o*n);c.length||a(4,"unable to allocate buffer space");let l=0,r=0;const s=4*t,i=new Uint8Array(4),R=new Uint8Array(s);let V=n;for(;V>0&&r<e.byteLength;){r+4>e.byteLength&&a(1),i[0]=e[r++],i[1]=e[r++],i[2]=e[r++],i[3]=e[r++],(i[0]!=2||i[1]!=2||(i[2]<<8|i[3])!=t)&&a(3,"bad rgbe scanline format");let S=0,h;for(;S<s&&r<e.byteLength;){h=e[r++];const g=h>128;if(g&&(h-=128),(h===0||S+h>s)&&a(3,"bad scanline data"),g){const f=e[r++];for(let U=0;U<h;U++)R[S++]=f}else R.set(e.subarray(r,r+h),S),S+=h,r+=h}const K=t;for(let g=0;g<K;g++){let f=0;c[l]=R[g+f],f+=t,c[l+1]=R[g+f],f+=t,c[l+2]=R[g+f],f+=t,c[l+3]=R[g+f],l+=4}V--}return c},X=function(e,o,n,t){const c=e[o+3],l=Math.pow(2,c-128)/255;n[t+0]=e[o+0]*l,n[t+1]=e[o+1]*l,n[t+2]=e[o+2]*l,n[t+3]=1},J=function(e,o,n,t){const c=e[o+3],l=Math.pow(2,c-128)/255;n[t+0]=G.toHalfFloat(Math.min(e[o+0]*l,65504)),n[t+1]=G.toHalfFloat(Math.min(e[o+1]*l,65504)),n[t+2]=G.toHalfFloat(Math.min(e[o+2]*l,65504)),n[t+3]=G.toHalfFloat(1)},x=new Uint8Array(d);x.pos=0;const E=$(x),z=E.width,W=E.height,F=q(x.subarray(x.pos),z,W);let A,k,M;switch(this.type){case H:M=F.length/4;const e=new Float32Array(M*4);for(let n=0;n<M;n++)X(F,n*4,e,n*4);A=e,k=H;break;case B:M=F.length/4;const o=new Uint16Array(M*4);for(let n=0;n<M;n++)J(F,n*4,o,n*4);A=o,k=B;break;default:throw new Error("THREE.RGBELoader: Unsupported type: "+this.type)}return{width:z,height:W,data:A,header:E.string,gamma:E.gamma,exposure:E.exposure,type:k}}setDataType(d){return this.type=d,this}load(d,w,D,b){function I(a,N){switch(a.type){case H:case B:a.colorSpace=Z,a.minFilter=P,a.magFilter=P,a.generateMipmaps=!1,a.flipY=!0;break}w&&w(a,N)}return super.load(d,I,D,b)}}let L,v,p,u,j,m,y,C,Y;const _={color:"#ffffff",bounces:3,ior:2.4,aberrationStrength:.01,fastChroma:!1,animate:!0};Me();async function Me(){L=new ee,v=new re(75,window.innerWidth/window.innerHeight,.1,1e3),v.position.set(28,15,7),p=new ae({antialias:!1}),p.setSize(window.innerWidth,window.innerHeight),p.toneMapping=oe,p.setAnimationLoop(Re),document.body.appendChild(p.domElement),j=new he(v,p.domElement),Y=new me;const T=new be().loadAsync("https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr"),d=new ge().loadAsync("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/diamond/diamond.glb");let w;[u,w]=await Promise.all([T,d]),u.mapping=ie,u.generateMipmaps=!0,u.minFilter=ne,u.magFilter=P,L.background=u;const D=new te({uniforms:{envMap:{value:u},bvh:{value:new we},projectionMatrixInv:{value:v.projectionMatrixInverse},viewMatrixInv:{value:v.matrixWorld},resolution:{value:new ce},bounces:{value:3},ior:{value:2.4},color:{value:new le(1,1,1)},fastChroma:{value:!1},aberrationStrength:{value:.01}},vertexShader:`
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

			${ue}
			${ye}
			${_e}

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
		`}),b=w.scene.children[0].children[0].children[0].children[0].children[0].geometry;b.scale(10,10,10);const I=new ve(b,{strategy:pe,maxLeafSize:1});D.uniforms.bvh.value.updateFrom(I),m=new se(b,D),L.add(m),y=new de,y.add(_,"animate"),y.addColor(_,"color").name("Color").onChange(a=>{m.material.uniforms.color.value.set(a)}),y.add(_,"bounces",1,10,1).name("Bounces").onChange(a=>{m.material.uniforms.bounces.value=a}),y.add(_,"ior",1,5,.01).name("IOR").onChange(a=>{m.material.uniforms.ior.value=a}),y.add(_,"fastChroma").onChange(a=>{m.material.uniforms.fastChroma.value=a}),y.add(_,"aberrationStrength",0,.1,1e-4).onChange(a=>{m.material.uniforms.aberrationStrength.value=a}),C=new fe,C.showPanel(0),document.body.appendChild(C.dom),window.addEventListener("resize",function(){v.aspect=window.innerWidth/window.innerHeight,v.updateProjectionMatrix(),m.material.uniforms.resolution.value.set(window.innerWidth,window.innerHeight),p.setSize(window.innerWidth,window.innerHeight)},!1)}function Re(){m&&(_.animate&&(m.rotation.y+=Y.getDelta()*.25),C.update(),j.update(),p.render(L,v))}
//# sourceMappingURL=diamond-C4uXC4je.js.map
