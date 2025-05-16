import{a1 as ne,H as W,F as X,a2 as V,a3 as te,L as q,c as ie,P as oe,W as le,a4 as ce,a5 as se,a6 as me,S as de,J as fe,C as he,M as pe,h as ve}from"./ExtendedTriangle-CFC-kWKu.js";import{g as ge}from"./lil-gui.module.min-jESndyO-.js";import{O as ue}from"./OrbitControls-DPxOa-V_.js";import{G as ye}from"./GLTFLoader-C_LgBif7.js";import{M as we,S as _e}from"./MeshBVH-CE-cOGaL.js";import{M as be}from"./MeshBVHUniformStruct-BasBaY-w.js";import{c as Re,b as Me,a as Ee}from"./bvh_struct_definitions.glsl-SZg5BxSQ.js";import"./BufferGeometryUtils-e7tZihaS.js";class De extends ne{constructor(c){super(c),this.type=W}parse(c){const e=function(r,n){switch(r){case 1:throw new Error("THREE.RGBELoader: Read Error: "+(n||""));case 2:throw new Error("THREE.RGBELoader: Write Error: "+(n||""));case 3:throw new Error("THREE.RGBELoader: Bad File Format: "+(n||""));default:case 4:throw new Error("THREE.RGBELoader: Memory Error: "+(n||""))}},f=`
`,h=function(r,n,o){n=n||1024;let m=r.pos,s=-1,a=0,d="",t=String.fromCharCode.apply(null,new Uint16Array(r.subarray(m,m+128)));for(;0>(s=t.indexOf(f))&&a<n&&m<r.byteLength;)d+=t,a+=t.length,m+=128,t+=String.fromCharCode.apply(null,new Uint16Array(r.subarray(m,m+128)));return-1<s?(r.pos+=a+s+1,d+t.slice(0,s)):!1},w=function(r){const n=/^#\?(\S+)/,o=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,l=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,m=/^\s*FORMAT=(\S+)\s*$/,s=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,a={valid:0,string:"",comments:"",programtype:"RGBE",format:"",gamma:1,exposure:1,width:0,height:0};let d,t;for((r.pos>=r.byteLength||!(d=h(r)))&&e(1,"no header found"),(t=d.match(n))||e(3,"bad initial token"),a.valid|=1,a.programtype=t[1],a.string+=d+`
`;d=h(r),d!==!1;){if(a.string+=d+`
`,d.charAt(0)==="#"){a.comments+=d+`
`;continue}if((t=d.match(o))&&(a.gamma=parseFloat(t[1])),(t=d.match(l))&&(a.exposure=parseFloat(t[1])),(t=d.match(m))&&(a.valid|=2,a.format=t[1]),(t=d.match(s))&&(a.valid|=4,a.height=parseInt(t[1],10),a.width=parseInt(t[2],10)),a.valid&2&&a.valid&4)break}return a.valid&2||e(3,"missing format specifier"),a.valid&4||e(3,"missing image size specifier"),a},S=function(r,n,o){const l=n;if(l<8||l>32767||r[0]!==2||r[1]!==2||r[2]&128)return new Uint8Array(r);l!==(r[2]<<8|r[3])&&e(3,"wrong scanline width");const m=new Uint8Array(4*n*o);m.length||e(4,"unable to allocate buffer space");let s=0,a=0;const d=4*l,t=new Uint8Array(4),C=new Uint8Array(d);let K=o;for(;K>0&&a<r.byteLength;){a+4>r.byteLength&&e(1),t[0]=r[a++],t[1]=r[a++],t[2]=r[a++],t[3]=r[a++],(t[0]!=2||t[1]!=2||(t[2]<<8|t[3])!=l)&&e(3,"bad rgbe scanline format");let k=0,_;for(;k<d&&a<r.byteLength;){_=r[a++];const b=_>128;if(b&&(_-=128),(_===0||k+_>d)&&e(3,"bad scanline data"),b){const R=r[a++];for(let Q=0;Q<_;Q++)C[k++]=R}else C.set(r.subarray(a,a+_),k),k+=_,a+=_}const ae=l;for(let b=0;b<ae;b++){let R=0;m[s]=C[b+R],R+=l,m[s+1]=C[b+R],R+=l,m[s+2]=C[b+R],R+=l,m[s+3]=C[b+R],s+=4}K--}return m},x=function(r,n,o,l){const m=r[n+3],s=Math.pow(2,m-128)/255;o[l+0]=r[n+0]*s,o[l+1]=r[n+1]*s,o[l+2]=r[n+2]*s,o[l+3]=1},I=function(r,n,o,l){const m=r[n+3],s=Math.pow(2,m-128)/255;o[l+0]=V.toHalfFloat(Math.min(r[n+0]*s,65504)),o[l+1]=V.toHalfFloat(Math.min(r[n+1]*s,65504)),o[l+2]=V.toHalfFloat(Math.min(r[n+2]*s,65504)),o[l+3]=V.toHalfFloat(1)},i=new Uint8Array(c);i.pos=0;const y=w(i),z=y.width,J=y.height,N=S(i.subarray(i.pos),z,J);let Y,$,H;switch(this.type){case X:H=N.length/4;const r=new Float32Array(H*4);for(let o=0;o<H;o++)x(N,o*4,r,o*4);Y=r,$=X;break;case W:H=N.length/4;const n=new Uint16Array(H*4);for(let o=0;o<H;o++)I(N,o*4,n,o*4);Y=n,$=W;break;default:throw new Error("THREE.RGBELoader: Unsupported type: "+this.type)}return{width:z,height:J,data:Y,header:y.string,gamma:y.gamma,exposure:y.exposure,type:$}}setDataType(c){return this.type=c,this}load(c,p,g,v){function u(e,D){switch(e.type){case X:case W:e.colorSpace=te,e.minFilter=q,e.magFilter=q,e.generateMipmaps=!1,e.flipY=!0;break}p&&p(e,D)}return super.load(c,u,g,v)}}var O=function(){var E=0,c=document.createElement("div");c.style.cssText="position:fixed;top:0;left:0;cursor:pointer;opacity:0.9;z-index:10000",c.addEventListener("click",function(f){f.preventDefault(),g(++E%c.children.length)},!1);function p(f){return c.appendChild(f.dom),f}function g(f){for(var h=0;h<c.children.length;h++)c.children[h].style.display=h===f?"block":"none";E=f}var v=(performance||Date).now(),u=v,e=0,D=p(new O.Panel("FPS","#0ff","#002")),L=p(new O.Panel("MS","#0f0","#020"));if(self.performance&&self.performance.memory)var A=p(new O.Panel("MB","#f08","#201"));return g(0),{REVISION:16,dom:c,addPanel:p,showPanel:g,begin:function(){v=(performance||Date).now()},end:function(){e++;var f=(performance||Date).now();if(L.update(f-v,200),f>=u+1e3&&(D.update(e*1e3/(f-u),100),u=f,e=0,A)){var h=performance.memory;A.update(h.usedJSHeapSize/1048576,h.jsHeapSizeLimit/1048576)}return f},update:function(){v=this.end()},domElement:c,setMode:g}};O.Panel=function(E,c,p){var g=1/0,v=0,u=Math.round,e=u(window.devicePixelRatio||1),D=80*e,L=48*e,A=3*e,f=2*e,h=3*e,w=15*e,S=74*e,x=30*e,I=document.createElement("canvas");I.width=D,I.height=L,I.style.cssText="width:80px;height:48px";var i=I.getContext("2d");return i.font="bold "+9*e+"px Helvetica,Arial,sans-serif",i.textBaseline="top",i.fillStyle=p,i.fillRect(0,0,D,L),i.fillStyle=c,i.fillText(E,A,f),i.fillRect(h,w,S,x),i.fillStyle=p,i.globalAlpha=.9,i.fillRect(h,w,S,x),{dom:I,update:function(y,z){g=Math.min(g,y),v=Math.max(v,y),i.fillStyle=p,i.globalAlpha=1,i.fillRect(0,0,D,w),i.fillStyle=c,i.fillText(u(y)+" "+E+" ("+u(g)+"-"+u(v)+")",A,f),i.drawImage(I,h+e,w,S-e,x,h,w,S-e,x),i.fillRect(h+S-e,w,e,x),i.fillStyle=p,i.globalAlpha=.9,i.fillRect(h+S-e,w,e,u((1-y/z)*x))}}};let U,F,P,G,Z,M,B,j,ee;const T={color:"#ffffff",bounces:3,ior:2.4,aberrationStrength:.01,fastChroma:!1,animate:!0};Se();async function Se(){U=new ie,F=new oe(75,window.innerWidth/window.innerHeight,.1,1e3),F.position.set(28,15,7),P=new le({antialias:!1}),P.setSize(window.innerWidth,window.innerHeight),P.toneMapping=ce,document.body.appendChild(P.domElement),Z=new ue(F,P.domElement),ee=new ve;const E=new De().loadAsync("https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr"),c=new ye().loadAsync("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/diamond/diamond.glb");let p;[G,p]=await Promise.all([E,c]),G.mapping=se,G.generateMipmaps=!0,G.minFilter=me,G.magFilter=q,U.background=G;const g=new de({uniforms:{envMap:{value:G},bvh:{value:new be},projectionMatrixInv:{value:F.projectionMatrixInverse},viewMatrixInv:{value:F.matrixWorld},resolution:{value:new fe},bounces:{value:3},ior:{value:2.4},color:{value:new he(1,1,1)},fastChroma:{value:!1},aberrationStrength:{value:.01}},vertexShader:`
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

			${Re}
			${Me}
			${Ee}

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
		`}),v=p.scene.children[0].children[0].children[0].children[0].children[0].geometry;v.scale(10,10,10);const u=new we(v,{strategy:_e,maxLeafTris:1});g.uniforms.bvh.value.updateFrom(u),M=new pe(v,g),U.add(M),B=new ge,B.add(T,"animate"),B.addColor(T,"color").name("Color").onChange(e=>{M.material.uniforms.color.value.set(e)}),B.add(T,"bounces",1,10,1).name("Bounces").onChange(e=>{M.material.uniforms.bounces.value=e}),B.add(T,"ior",1,5,.01).name("IOR").onChange(e=>{M.material.uniforms.ior.value=e}),B.add(T,"fastChroma").onChange(e=>{M.material.uniforms.fastChroma.value=e}),B.add(T,"aberrationStrength",0,.1,1e-4).onChange(e=>{M.material.uniforms.aberrationStrength.value=e}),j=new O,j.showPanel(0),document.body.appendChild(j.dom),re(),window.addEventListener("resize",function(){F.aspect=window.innerWidth/window.innerHeight,F.updateProjectionMatrix(),M.material.uniforms.resolution.value.set(window.innerWidth,window.innerHeight),P.setSize(window.innerWidth,window.innerHeight)},!1)}function re(){T.animate&&(M.rotation.y+=ee.getDelta()*.25),j.update(),Z.update(),P.render(U,F),requestAnimationFrame(re)}
