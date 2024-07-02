import{O as Q,Q as O,K as V,U as z,X as Z,Y as j,S as ee,P as re,W as ae,s as ne,_ as te,$ as ie,a0 as oe,a1 as le,r as ce,C as se,M as me,e as de}from"./ExtendedTriangle-CdCvQVSB.js";import{g as fe}from"./lil-gui.module.min-Bc0DeA9g.js";import{O as he}from"./OrbitControls-iAm09Il8.js";import{G as ge}from"./GLTFLoader-CKopl1HH.js";import{M as ue,c as pe,b as ve,a as ye}from"./bvh_struct_definitions.glsl-DwALRlLp.js";import{M as _e,S as we}from"./MeshBVH-bmQbDysG.js";import"./BufferGeometryUtils-ChJfj-2T.js";class Re extends Q{constructor(m){super(m),this.type=O}parse(m){const f=function(e,t){switch(e){case 1:console.error("THREE.RGBELoader Read Error: "+(t||""));break;case 2:console.error("THREE.RGBELoader Write Error: "+(t||""));break;case 3:console.error("THREE.RGBELoader Bad File Format: "+(t||""));break;default:case 4:console.error("THREE.RGBELoader: Error: "+(t||""))}return-1},u=`
`,_=function(e,t,d){t=t||1024;let l=e.pos,i=-1,a=0,s="",n=String.fromCharCode.apply(null,new Uint16Array(e.subarray(l,l+128)));for(;0>(i=n.indexOf(u))&&a<t&&l<e.byteLength;)s+=n,a+=n.length,l+=128,n+=String.fromCharCode.apply(null,new Uint16Array(e.subarray(l,l+128)));return-1<i?(e.pos+=a+i+1,s+n.slice(0,i)):!1},x=function(e){const t=/^#\?(\S+)/,d=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,o=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,l=/^\s*FORMAT=(\S+)\s*$/,i=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,a={valid:0,string:"",comments:"",programtype:"RGBE",format:"",gamma:1,exposure:1,width:0,height:0};let s,n;if(e.pos>=e.byteLength||!(s=_(e)))return f(1,"no header found");if(!(n=s.match(t)))return f(3,"bad initial token");for(a.valid|=1,a.programtype=n[1],a.string+=s+`
`;s=_(e),s!==!1;){if(a.string+=s+`
`,s.charAt(0)==="#"){a.comments+=s+`
`;continue}if((n=s.match(d))&&(a.gamma=parseFloat(n[1])),(n=s.match(o))&&(a.exposure=parseFloat(n[1])),(n=s.match(l))&&(a.valid|=2,a.format=n[1]),(n=s.match(i))&&(a.valid|=4,a.height=parseInt(n[1],10),a.width=parseInt(n[2],10)),a.valid&2&&a.valid&4)break}return a.valid&2?a.valid&4?a:f(3,"missing image size specifier"):f(3,"missing format specifier")},S=function(e,t,d){const o=t;if(o<8||o>32767||e[0]!==2||e[1]!==2||e[2]&128)return new Uint8Array(e);if(o!==(e[2]<<8|e[3]))return f(3,"wrong scanline width");const l=new Uint8Array(4*t*d);if(!l.length)return f(4,"unable to allocate buffer space");let i=0,a=0;const s=4*o,n=new Uint8Array(4),H=new Uint8Array(s);let Y=d;for(;Y>0&&a<e.byteLength;){if(a+4>e.byteLength)return f(1);if(n[0]=e[a++],n[1]=e[a++],n[2]=e[a++],n[3]=e[a++],n[0]!=2||n[1]!=2||(n[2]<<8|n[3])!=o)return f(3,"bad rgbe scanline format");let k=0,R;for(;k<s&&a<e.byteLength;){R=e[a++];const b=R>128;if(b&&(R-=128),R===0||k+R>s)return f(3,"bad scanline data");if(b){const E=e[a++];for(let $=0;$<R;$++)H[k++]=E}else H.set(e.subarray(a,a+R),k),k+=R,a+=R}const K=o;for(let b=0;b<K;b++){let E=0;l[i]=H[b+E],E+=o,l[i+1]=H[b+E],E+=o,l[i+2]=H[b+E],E+=o,l[i+3]=H[b+E],i+=4}Y--}return l},I=function(e,t,d,o){const l=e[t+3],i=Math.pow(2,l-128)/255;d[o+0]=e[t+0]*i,d[o+1]=e[t+1]*i,d[o+2]=e[t+2]*i,d[o+3]=1},c=function(e,t,d,o){const l=e[t+3],i=Math.pow(2,l-128)/255;d[o+0]=z.toHalfFloat(Math.min(e[t+0]*i,65504)),d[o+1]=z.toHalfFloat(Math.min(e[t+1]*i,65504)),d[o+2]=z.toHalfFloat(Math.min(e[t+2]*i,65504)),d[o+3]=z.toHalfFloat(1)},w=new Uint8Array(m);w.pos=0;const G=x(w);if(G!==-1){const e=G.width,t=G.height,d=S(w.subarray(w.pos),e,t);if(d!==-1){let o,l,i;switch(this.type){case V:i=d.length/4;const a=new Float32Array(i*4);for(let n=0;n<i;n++)I(d,n*4,a,n*4);o=a,l=V;break;case O:i=d.length/4;const s=new Uint16Array(i*4);for(let n=0;n<i;n++)c(d,n*4,s,n*4);o=s,l=O;break;default:console.error("THREE.RGBELoader: unsupported type: ",this.type);break}return{width:e,height:t,data:o,header:G.string,gamma:G.gamma,exposure:G.exposure,type:l}}}return null}setDataType(m){return this.type=m,this}load(m,g,v,p){function y(r,f){switch(r.type){case V:case O:r.encoding=Z,r.minFilter=j,r.magFilter=j,r.generateMipmaps=!1,r.flipY=!0;break}g&&g(r,f)}return super.load(m,y,v,p)}}var N=function(){var D=0,m=document.createElement("div");m.style.cssText="position:fixed;top:0;left:0;cursor:pointer;opacity:0.9;z-index:10000",m.addEventListener("click",function(h){h.preventDefault(),v(++D%m.children.length)},!1);function g(h){return m.appendChild(h.dom),h}function v(h){for(var u=0;u<m.children.length;u++)m.children[u].style.display=u===h?"block":"none";D=h}var p=(performance||Date).now(),y=p,r=0,f=g(new N.Panel("FPS","#0ff","#002")),C=g(new N.Panel("MS","#0f0","#020"));if(self.performance&&self.performance.memory)var L=g(new N.Panel("MB","#f08","#201"));return v(0),{REVISION:16,dom:m,addPanel:g,showPanel:v,begin:function(){p=(performance||Date).now()},end:function(){r++;var h=(performance||Date).now();if(C.update(h-p,200),h>=y+1e3&&(f.update(r*1e3/(h-y),100),y=h,r=0,L)){var u=performance.memory;L.update(u.usedJSHeapSize/1048576,u.jsHeapSizeLimit/1048576)}return h},update:function(){p=this.end()},domElement:m,setMode:v}};N.Panel=function(D,m,g){var v=1/0,p=0,y=Math.round,r=y(window.devicePixelRatio||1),f=80*r,C=48*r,L=3*r,h=2*r,u=3*r,_=15*r,x=74*r,S=30*r,I=document.createElement("canvas");I.width=f,I.height=C,I.style.cssText="width:80px;height:48px";var c=I.getContext("2d");return c.font="bold "+9*r+"px Helvetica,Arial,sans-serif",c.textBaseline="top",c.fillStyle=g,c.fillRect(0,0,f,C),c.fillStyle=m,c.fillText(D,L,h),c.fillRect(u,_,x,S),c.fillStyle=g,c.globalAlpha=.9,c.fillRect(u,_,x,S),{dom:I,update:function(w,G){v=Math.min(v,w),p=Math.max(p,w),c.fillStyle=g,c.globalAlpha=1,c.fillRect(0,0,f,_),c.fillStyle=m,c.fillText(y(w)+" "+D+" ("+y(v)+"-"+y(p)+")",L,h),c.drawImage(I,u+r,_,x-r,S,u,_,x-r,S),c.fillRect(u+x-r,_,r,S),c.fillStyle=g,c.globalAlpha=.9,c.fillRect(u+x-r,_,r,y((1-w/G)*S))}}};let U,F,B,T,X,M,A,W,q;const P={color:"#ffffff",bounces:3,ior:2.4,aberrationStrength:.01,fastChroma:!1,animate:!0};be();async function be(){U=new ee,F=new re(75,window.innerWidth/window.innerHeight,.1,1e3),F.position.set(28,15,7),B=new ae({antialias:!1}),B.setSize(window.innerWidth,window.innerHeight),B.outputEncoding=ne,B.toneMapping=te,document.body.appendChild(B.domElement),X=new he(F,B.domElement),q=new de;const D=new Re().loadAsync("https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr"),m=new ge().loadAsync("https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/diamond/diamond.glb");let g;[T,g]=await Promise.all([D,m]),T.mapping=ie,T.generateMipmaps=!0,T.minFilter=oe,T.magFilter=j,U.background=T;const v=new le({uniforms:{envMap:{value:T},bvh:{value:new ue},projectionMatrixInv:{value:F.projectionMatrixInverse},viewMatrixInv:{value:F.matrixWorld},resolution:{value:new ce},bounces:{value:3},ior:{value:2.4},color:{value:new se(1,1,1)},fastChroma:{value:!1},aberrationStrength:{value:.01}},vertexShader:`
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

			${pe}
			${ve}
			${ye}

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
				#include <encodings_fragment>

			}
		`}),p=g.scene.children[0].children[0].children[0].children[0].children[0].geometry;p.scale(10,10,10);const y=new _e(p,{strategy:we,maxLeafTris:1});v.uniforms.bvh.value.updateFrom(y),M=new me(p,v),U.add(M),A=new fe,A.add(P,"animate"),A.addColor(P,"color").name("Color").onChange(r=>{M.material.uniforms.color.value.set(r)}),A.add(P,"bounces",1,10,1).name("Bounces").onChange(r=>{M.material.uniforms.bounces.value=r}),A.add(P,"ior",1,5,.01).name("IOR").onChange(r=>{M.material.uniforms.ior.value=r}),A.add(P,"fastChroma").onChange(r=>{M.material.uniforms.fastChroma.value=r}),A.add(P,"aberrationStrength",0,.1,1e-4).onChange(r=>{M.material.uniforms.aberrationStrength.value=r}),W=new N,W.showPanel(0),document.body.appendChild(W.dom),J(),window.addEventListener("resize",function(){F.aspect=window.innerWidth/window.innerHeight,F.updateProjectionMatrix(),M.material.uniforms.resolution.value.set(window.innerWidth,window.innerHeight),B.setSize(window.innerWidth,window.innerHeight)},!1)}function J(){P.animate&&(M.rotation.y+=q.getDelta()*.25),W.update(),X.update(),B.render(U,F),requestAnimationFrame(J)}
