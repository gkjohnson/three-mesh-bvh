import{M as $,k as R,r as H,W as _,a9 as U,aa as I,K as j,S as G,P as N,c as Q,a6 as q,ab as K,m as X,R as Y,V as J,a1 as Z,C as M}from"./ExtendedTriangle-CdCvQVSB.js";import{O as ee}from"./OrbitControls-iAm09Il8.js";import{G as te}from"./GLTFLoader-CKopl1HH.js";import{F as oe}from"./Pass-BfbAPnNm.js";import{g as ae}from"./lil-gui.module.min-Bc0DeA9g.js";import{a as re,c as ne,d as ie}from"./ExtensionUtilities-CKmVgocB.js";import{M as se}from"./MeshBVHHelper-BgADMb3C.js";import{C as le,A as de,S as O}from"./MeshBVH-BATg3dsp.js";import{g as me,e as B}from"./Debug-z_34dnkV.js";import"./BufferGeometryUtils-ChJfj-2T.js";$.prototype.raycast=re;R.prototype.computeBoundsTree=ne;R.prototype.disposeBoundsTree=ie;let w,c,o,u,a,S,D,l,h,s,T=new H;const P=new Float32Array(1),ce="https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/dragon-attenuation/DragonAttenuation.glb",e={options:{strategy:O,maxLeafTris:10,maxDepth:40,rebuild:function(){L()}},visualization:{displayMesh:!0,simpleColors:!1,outline:!0,traversalThreshold:50},benchmark:{displayRays:!1,firstHitOnly:!0,rotations:10,castCount:1e3}},ue=16763432,fe=8231,he=15277667;class pe extends Z{constructor(n){super({uniforms:{map:{value:null},threshold:{value:35},boundsColor:{value:new M(16777215)},backgroundColor:{value:new M(0)},thresholdColor:{value:new M(16711680)},resolution:{value:new H},outlineAlpha:{value:.5}},vertexShader:`
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
			`});const t=this.uniforms;for(const r in t)Object.defineProperty(this,r,{get(){return this.uniforms[r].value},set(i){this.uniforms[r].value=i}});this.setValues(n)}}function ge(){S=document.getElementById("output"),D=document.getElementById("benchmark"),o=new _({antialias:!0}),o.setPixelRatio(window.devicePixelRatio),o.setSize(window.innerWidth,window.innerHeight),o.setClearColor(0,1),document.body.appendChild(o.domElement),h=new U(1,1,{format:I,type:j}),s=new oe(new pe({map:h.texture,depthWrite:!1})),w=new G,c=new N(75,window.innerWidth/window.innerHeight,.1,50),c.position.set(-2.5,1.5,2.5),c.far=100,c.updateProjectionMatrix(),new ee(c,o.domElement),window.addEventListener("resize",z,!1),z(),new te().load(ce,m=>{m.scene.traverse(f=>{f.isMesh&&f.name==="Dragon"&&(a=f)}),a.material=new Q({colorWrite:!1}),a.geometry.center(),a.position.set(0,0,0),w.add(a),u=new se(a,40),u.displayEdges=!1,u.displayParents=!0,u.color.set(16777215),u.opacity=1,u.depth=40;const g=u.meshMaterial;g.blending=q,g.blendDst=K,w.add(u),L(),x(!0)}),l=new X,l.material.opacity=.1,l.material.transparent=!0,l.material.depthWrite=!1,l.frustumCulled=!1,w.add(l);const n=new ae,t=n.addFolder("BVH");t.add(e.options,"strategy",{CENTER:le,AVERAGE:de,SAH:O}),t.add(e.options,"maxLeafTris",1,30,1),t.add(e.options,"maxDepth",1,40,1),t.add(e.options,"rebuild"),t.open();const r=n.addFolder("Visualization");r.add(e.visualization,"displayMesh"),r.add(e.visualization,"simpleColors"),r.add(e.visualization,"outline"),r.add(e.visualization,"traversalThreshold",1,300,1),r.open();const i=n.addFolder("Benchmark");i.add(e.benchmark,"displayRays"),i.add(e.benchmark,"firstHitOnly").onChange(b),i.add(e.benchmark,"castCount",100,5e3,1).onChange(()=>{b(),x(!0)}),i.add(e.benchmark,"rotations",1,20,1).onChange(()=>{b(),x(!0)}),i.open(),window.addEventListener("pointermove",m=>{T.set(m.clientX,window.innerHeight-m.clientY)})}function z(){c.aspect=window.innerWidth/window.innerHeight,c.updateProjectionMatrix(),o.setSize(window.innerWidth,window.innerHeight),o.setPixelRatio(window.devicePixelRatio),h.setSize(window.innerWidth*window.devicePixelRatio,window.innerHeight*window.devicePixelRatio)}function L(){const d=performance.now();a.geometry.computeBoundsTree({strategy:parseInt(e.options.strategy),maxLeafTris:e.options.maxLeafTris,maxDepth:e.options.maxDepth});const n=performance.now()-d;u.update(),b();const t=me(a.geometry.boundsTree)[0];S.innerText=`construction time        : ${n.toFixed(2)}ms
surface area score       : ${t.surfaceAreaScore.toFixed(2)}
total nodes              : ${t.nodeCount}
total leaf nodes         : ${t.leafNodeCount}
min / max tris per leaf  : ${t.tris.min} / ${t.tris.max}
min / max depth          : ${t.depth.min} / ${t.depth.max}
memory (incl. geometry)  : ${(B(a.geometry.boundsTree)*1e-6).toFixed(3)} mb 
memory (excl. geometry)  : ${(B(a.geometry.boundsTree._roots)*1e-6).toFixed(3)} mb`}function x(d=!1){let n=null,t=null;d&&(a.updateMatrixWorld(),t=new R,l.geometry.dispose(),n=[]);const r=new Y;r.firstHitOnly=e.benchmark.firstHitOnly;const i=e.benchmark.castCount,m=e.benchmark.rotations,{ray:g}=r,{origin:f,direction:A}=g,V=performance.now();for(let v=0;v<i;v++){const p=v/i-.5;if(f.set(Math.cos(.75*Math.PI*p)*Math.sin(m*2*Math.PI*v/i),2*p,Math.cos(.75*Math.PI*p)*Math.cos(m*2*Math.PI*v/i)).multiplyScalar(2.5),A.set(Math.cos(m*5*p),Math.sin(m*10*p),Math.sin(m*5*p)).sub(f).normalize(),r.intersectObject(a),d){const k=r.intersectObject(a)[0];if(n.push(f.clone()),k)n.push(k.point.clone());else{const F=new J;g.at(5,F),n.push(F)}}}const W=performance.now()-V;return d&&(t.setFromPoints(n),l.geometry=t),W}let y=0,C=0;function b(){y=0,C=0}function E(){requestAnimationFrame(E);const d=o.getPixelRatio();o.readRenderTargetPixels(h,T.x*d,T.y*d,1,1,P),a&&(y=Math.min(y+1,50),C+=(x()-C)/y,D.innerText=`
traversal depth at mouse : ${Math.round(P[0])}
benchmark rolling avg    : ${C.toFixed(3)} ms`),e.visualization.simpleColors?(s.material.boundsColor.set(16777215),s.material.thresholdColor.set(16711680),s.material.backgroundColor.set(0)):(s.material.boundsColor.set(ue),s.material.thresholdColor.set(he),s.material.backgroundColor.set(fe)),s.material.threshold=e.visualization.traversalThreshold,s.material.outlineAlpha=e.visualization.outline?.5:0,s.material.resolution.set(h.width,h.height),l.visible=!1,o.autoClear=!0,a&&(a.visible=e.visualization.displayMesh),o.setRenderTarget(h),o.render(w,c),o.setRenderTarget(null),s.render(o),o.autoClear=!1,l.visible=e.benchmark.displayRays,a&&o.render(a,c),o.render(l,c)}ge();E();
