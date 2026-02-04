import{M as W,i as R,J as S,C as x,W as $,aa as _,F as U,R as I,c as j,P as G,f as N,a7 as Q,ab as J,v as X,S as Y,k as q,V as K}from"./ExtendedTriangle-hsPasuNU.js";import{O as Z}from"./OrbitControls-DEZHvbFX.js";import{G as ee}from"./GLTFLoader-Be-eETKy.js";import{F as te}from"./Pass-BOKrxmL7.js";import{g as oe}from"./lil-gui.module.min-BH_YJbPT.js";import{S as H,A as ae,C as re}from"./MeshBVH-DQV6PBDm.js";import{g as ne,e as B}from"./Debug-DgSlAya1.js";import{a as ie,c as se,d as le}from"./ExtensionUtilities-BlnM4xb7.js";import{B as de}from"./BVHHelper-DA_xcAFF.js";import"./BufferGeometryUtils-BuPYlHUL.js";W.prototype.raycast=ie;R.prototype.computeBoundsTree=se;R.prototype.disposeBoundsTree=le;let w,c,o,u,a,O,L,l,h,s,T=new S;const z=new Float32Array(1),me="https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/dragon-attenuation/DragonAttenuation.glb",e={options:{strategy:H,maxLeafSize:10,maxDepth:40,rebuild:function(){D()}},visualization:{displayMesh:!0,simpleColors:!1,outline:!0,traversalThreshold:50},benchmark:{displayRays:!1,firstHitOnly:!0,rotations:10,castCount:1e3}},ce=new x(16770670).convertLinearToSRGB().getHex(),ue=25453,fe=16081063;class he extends Y{constructor(n){super({uniforms:{map:{value:null},threshold:{value:35},boundsColor:{value:new x(16777215)},backgroundColor:{value:new x(0)},thresholdColor:{value:new x(16711680)},resolution:{value:new S},outlineAlpha:{value:.5}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,fragmentShader:`
				uniform sampler2D map;
				uniform float threshold;

				uniform vec3 thresholdColor;
				uniform vec3 boundsColor;
				uniform vec3 backgroundColor;
				uniform vec2 resolution;
				uniform float outlineAlpha;

				varying vec2 vUv;
				void main() {

					float count = texture2D( map, vUv ).r;

					if ( count == 0.0 ) {

						vec2 offset = 1.0 / resolution;
						float c1 = texture2D( map, vUv + offset * vec2( 1.0, 0.0 ) ).r;
						float c2 = texture2D( map, vUv + offset * vec2( - 1.0, 0.0 ) ).r;
						float c3 = texture2D( map, vUv + offset * vec2( 0.0, 1.0 ) ).r;
						float c4 = texture2D( map, vUv + offset * vec2( 0.0, - 1.0 ) ).r;

						float maxC = max( c1, max( c2, max( c3, c4 ) ) );
						if ( maxC != 0.0 ) {

							gl_FragColor.rgb = mix( backgroundColor, mix( boundsColor, vec3( 1.0 ), 0.5 ), outlineAlpha );
							gl_FragColor.a = 1.0;
							return;

						}

					}

					if ( count > threshold ) {

						gl_FragColor.rgb = thresholdColor.rgb;
						gl_FragColor.a = 1.0;

					} else {

						float alpha = count / threshold;
						vec3 color = mix( boundsColor, vec3( 1.0 ), pow( alpha, 1.75 ) );

						gl_FragColor.rgb = mix( backgroundColor, color, alpha ).rgb ;
						gl_FragColor.a = 1.0;

					}

				}
			`});const t=this.uniforms;for(const r in t)Object.defineProperty(this,r,{get(){return this.uniforms[r].value},set(i){this.uniforms[r].value=i}});this.setValues(n)}}function pe(){O=document.getElementById("output"),L=document.getElementById("benchmark"),o=new $({antialias:!0}),o.setPixelRatio(window.devicePixelRatio),o.setSize(window.innerWidth,window.innerHeight),o.setClearColor(0,1),o.setAnimationLoop(ve),document.body.appendChild(o.domElement),h=new _(1,1,{format:I,type:U}),s=new te(new he({map:h.texture,depthWrite:!1})),w=new j,c=new G(75,window.innerWidth/window.innerHeight,.1,50),c.position.set(-2.5,1.5,2.5),c.far=100,c.updateProjectionMatrix(),new Z(c,o.domElement),window.addEventListener("resize",P,!1),P(),new ee().load(me,m=>{m.scene.traverse(f=>{f.isMesh&&f.name==="Dragon"&&(a=f)}),a.material=new N({colorWrite:!1}),a.geometry.center(),a.position.set(0,0,0),w.add(a),u=new de(a,40),u.displayEdges=!1,u.displayParents=!0,u.color.set(16777215),u.opacity=1,u.depth=40;const v=u.meshMaterial;v.blending=Q,v.blendDst=J,w.add(u),D(),y(!0)}),l=new X,l.material.opacity=.1,l.material.transparent=!0,l.material.depthWrite=!1,l.frustumCulled=!1,w.add(l);const n=new oe,t=n.addFolder("BVH");t.add(e.options,"strategy",{CENTER:re,AVERAGE:ae,SAH:H}),t.add(e.options,"maxLeafSize",1,30,1),t.add(e.options,"maxDepth",1,40,1),t.add(e.options,"rebuild"),t.open();const r=n.addFolder("Visualization");r.add(e.visualization,"displayMesh"),r.add(e.visualization,"simpleColors"),r.add(e.visualization,"outline"),r.add(e.visualization,"traversalThreshold",1,300,1),r.open();const i=n.addFolder("Benchmark");i.add(e.benchmark,"displayRays"),i.add(e.benchmark,"firstHitOnly").onChange(M),i.add(e.benchmark,"castCount",100,5e3,1).onChange(()=>{M(),y(!0)}),i.add(e.benchmark,"rotations",1,20,1).onChange(()=>{M(),y(!0)}),i.open(),window.addEventListener("pointermove",m=>{T.set(m.clientX,window.innerHeight-m.clientY)})}function P(){c.aspect=window.innerWidth/window.innerHeight,c.updateProjectionMatrix(),o.setSize(window.innerWidth,window.innerHeight),o.setPixelRatio(window.devicePixelRatio),h.setSize(window.innerWidth*window.devicePixelRatio,window.innerHeight*window.devicePixelRatio)}function D(){const d=performance.now();a.geometry.computeBoundsTree({strategy:parseInt(e.options.strategy),maxLeafSize:e.options.maxLeafSize,maxDepth:e.options.maxDepth});const n=performance.now()-d;u.update(),M();const t=ne(a.geometry.boundsTree)[0];O.innerText=`construction time        : ${n.toFixed(2)}ms
surface area score       : ${t.surfaceAreaScore.toFixed(2)}
total nodes              : ${t.nodeCount}
total leaf nodes         : ${t.leafNodeCount}
min / max tris per leaf  : ${t.tris.min} / ${t.tris.max}
min / max depth          : ${t.depth.min} / ${t.depth.max}
memory (incl. geometry)  : ${(B(a.geometry.boundsTree)*1e-6).toFixed(3)} mb 
memory (excl. geometry)  : ${(B(a.geometry.boundsTree._roots)*1e-6).toFixed(3)} mb`}function y(d=!1){let n=null,t=null;d&&(a.updateMatrixWorld(),t=new R,l.geometry.dispose(),n=[]);const r=new q;r.firstHitOnly=e.benchmark.firstHitOnly;const i=e.benchmark.castCount,m=e.benchmark.rotations,{ray:v}=r,{origin:f,direction:E}=v,A=performance.now();for(let g=0;g<i;g++){const p=g/i-.5;if(f.set(Math.cos(.75*Math.PI*p)*Math.sin(m*2*Math.PI*g/i),2*p,Math.cos(.75*Math.PI*p)*Math.cos(m*2*Math.PI*g/i)).multiplyScalar(2.5),E.set(Math.cos(m*5*p),Math.sin(m*10*p),Math.sin(m*5*p)).sub(f).normalize(),r.intersectObject(a),d){const k=r.intersectObject(a)[0];if(n.push(f.clone()),k)n.push(k.point.clone());else{const F=new K;v.at(5,F),n.push(F)}}}const V=performance.now()-A;return d&&(t.setFromPoints(n),l.geometry=t),V}let C=0,b=0;function M(){C=0,b=0}function ve(){const d=o.getPixelRatio();o.readRenderTargetPixels(h,T.x*d,T.y*d,1,1,z),a&&(C=Math.min(C+1,50),b+=(y()-b)/C,L.innerText=`
traversal depth at mouse : ${Math.round(z[0])}
benchmark rolling avg    : ${b.toFixed(3)} ms`),e.visualization.simpleColors?(s.material.boundsColor.set(16777215),s.material.thresholdColor.set(16711680),s.material.backgroundColor.set(0)):(s.material.boundsColor.set(ce),s.material.thresholdColor.set(fe),s.material.backgroundColor.set(ue)),s.material.threshold=e.visualization.traversalThreshold,s.material.outlineAlpha=e.visualization.outline?.5:0,s.material.resolution.set(h.width,h.height),l.visible=!1,o.autoClear=!0,a&&(a.visible=e.visualization.displayMesh),o.setRenderTarget(h),o.render(w,c),o.setRenderTarget(null),s.render(o),o.autoClear=!1,l.visible=e.benchmark.displayRays,a&&o.render(a,c),o.render(l,c)}pe();
//# sourceMappingURL=inspector-BnGIwZ_1.js.map
