import{Jr as e,Ot as t,S as n,Ut as r,Wt as i,Y as a,Yr as o,_ as s,_r as c,ei as l,gr as u,i as d,on as f,rr as p,tr as m}from"./ExtendedTriangle-DOKLf4jx.js";import{t as h}from"./Pass-WYNZO8G0.js";import{t as g}from"./BVHHelper-CWLCWlLT.js";import{n as _,t as v}from"./Debug-Z0-BhqHw.js";import{a as y,r as b,t as x}from"./ExtensionUtilities-DouVwDkp.js";import{t as S}from"./lil-gui.module.min-CCk8J1jY.js";import{t as C}from"./GLTFLoader-p6qoQbZ1.js";import{t as w}from"./OrbitControls-BX2ddTIw.js";r.prototype.raycast=x,s.prototype.computeBoundsTree=b,s.prototype.disposeBoundsTree=y;var T,E,D,O,k,A,j,M,N,P,F=new e,I=new Float32Array(1),L=`https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/dragon-attenuation/DragonAttenuation.glb`,R={options:{strategy:2,targetLeafSize:10,maxDepth:40,rebuild:function(){G()}},visualization:{displayMesh:!0,simpleColors:!1,outline:!0,traversalThreshold:50},benchmark:{displayRays:!1,firstHitOnly:!0,rotations:10,castCount:1e3}},z=new n(16770670).convertLinearToSRGB().getHex(),B=25453,V=16081063,H=class extends c{constructor(t){super({uniforms:{map:{value:null},threshold:{value:35},boundsColor:{value:new n(16777215)},backgroundColor:{value:new n(0)},thresholdColor:{value:new n(16711680)},resolution:{value:new e},outlineAlpha:{value:.5}},vertexShader:`
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
			`});let r=this.uniforms;for(let e in r)Object.defineProperty(this,e,{get(){return this.uniforms[e].value},set(t){this.uniforms[e].value=t}});this.setValues(t)}};function U(){A=document.getElementById(`output`),j=document.getElementById(`benchmark`),D=new d({antialias:!0}),D.setPixelRatio(window.devicePixelRatio),D.setSize(window.innerWidth,window.innerHeight),D.setClearColor(0,1),D.setAnimationLoop(X),document.body.appendChild(D.domElement),N=new l(1,1,{format:p,type:a}),P=new h(new H({map:N.texture,depthWrite:!1})),T=new u,E=new f(75,window.innerWidth/window.innerHeight,.1,50),E.position.set(-2.5,1.5,2.5),E.far=100,E.updateProjectionMatrix(),new w(E,D.domElement),window.addEventListener(`resize`,W,!1),W(),new C().load(L,e=>{e.scene.traverse(e=>{e.isMesh&&e.name===`Dragon`&&(k=e)}),k.material=new i({colorWrite:!1}),k.geometry.center(),k.position.set(0,0,0),T.add(k),O=new g(k,40),O.displayEdges=!1,O.displayParents=!0,O.color.set(16777215),O.opacity=1,O.depth=40;let t=O.meshMaterial;t.blending=5,t.blendDst=201,T.add(O),G(),K(!0)}),M=new t,M.material.opacity=.1,M.material.transparent=!0,M.material.depthWrite=!1,M.frustumCulled=!1,T.add(M);let e=new S,n=e.addFolder(`BVH`);n.add(R.options,`strategy`,{CENTER:0,AVERAGE:1,SAH:2}),n.add(R.options,`targetLeafSize`,1,30,1),n.add(R.options,`maxDepth`,1,40,1),n.add(R.options,`rebuild`),n.open();let r=e.addFolder(`Visualization`);r.add(R.visualization,`displayMesh`),r.add(R.visualization,`simpleColors`),r.add(R.visualization,`outline`),r.add(R.visualization,`traversalThreshold`,1,300,1),r.open();let o=e.addFolder(`Benchmark`);o.add(R.benchmark,`displayRays`),o.add(R.benchmark,`firstHitOnly`).onChange(Y),o.add(R.benchmark,`castCount`,100,5e3,1).onChange(()=>{Y(),K(!0)}),o.add(R.benchmark,`rotations`,1,20,1).onChange(()=>{Y(),K(!0)}),o.open(),window.addEventListener(`pointermove`,e=>{F.set(e.clientX,window.innerHeight-e.clientY)})}function W(){E.aspect=window.innerWidth/window.innerHeight,E.updateProjectionMatrix(),D.setSize(window.innerWidth,window.innerHeight),D.setPixelRatio(window.devicePixelRatio),N.setSize(window.innerWidth*window.devicePixelRatio,window.innerHeight*window.devicePixelRatio)}function G(){let e=performance.now();k.geometry.computeBoundsTree({strategy:parseInt(R.options.strategy),targetLeafSize:R.options.targetLeafSize,maxDepth:R.options.maxDepth});let t=performance.now()-e;O.update(),Y();let n=_(k.geometry.boundsTree)[0];A.innerText=`construction time        : ${t.toFixed(2)}ms\nsurface area score       : ${n.surfaceAreaScore.toFixed(2)}\ntotal nodes              : ${n.nodeCount}\ntotal leaf nodes         : ${n.leafNodeCount}\nmin / max tris per leaf  : ${n.tris.min} / ${n.tris.max}\nmin / max depth          : ${n.depth.min} / ${n.depth.max}\nmemory (incl. geometry)  : ${(v(k.geometry.boundsTree)*1e-6).toFixed(3)} mb \nmemory (excl. geometry)  : ${(v(k.geometry.boundsTree._roots)*1e-6).toFixed(3)} mb`}function K(e=!1){let t=null,n=null;e&&(k.updateMatrixWorld(),n=new s,M.geometry.dispose(),t=[]);let r=new m;r.firstHitOnly=R.benchmark.firstHitOnly;let i=R.benchmark.castCount,a=R.benchmark.rotations,{ray:c}=r,{origin:l,direction:u}=c,d=performance.now();for(let n=0;n<i;n++){let s=n/i-.5;if(l.set(Math.cos(.75*Math.PI*s)*Math.sin(a*2*Math.PI*n/i),2*s,Math.cos(.75*Math.PI*s)*Math.cos(a*2*Math.PI*n/i)).multiplyScalar(2.5),u.set(Math.cos(a*5*s),Math.sin(a*10*s),Math.sin(a*5*s)).sub(l).normalize(),r.intersectObject(k),e){let e=r.intersectObject(k)[0];if(t.push(l.clone()),e)t.push(e.point.clone());else{let e=new o;c.at(5,e),t.push(e)}}}let f=performance.now()-d;return e&&(n.setFromPoints(t),M.geometry=n),f}var q=0,J=0;function Y(){q=0,J=0}function X(){let e=D.getPixelRatio();D.readRenderTargetPixels(N,F.x*e,F.y*e,1,1,I),k&&(q=Math.min(q+1,50),J+=(K()-J)/q,j.innerText=`\ntraversal depth at mouse : ${Math.round(I[0])}\nbenchmark rolling avg    : ${J.toFixed(3)} ms`),R.visualization.simpleColors?(P.material.boundsColor.set(16777215),P.material.thresholdColor.set(16711680),P.material.backgroundColor.set(0)):(P.material.boundsColor.set(z),P.material.thresholdColor.set(V),P.material.backgroundColor.set(B)),P.material.threshold=R.visualization.traversalThreshold,P.material.outlineAlpha=R.visualization.outline?.5:0,P.material.resolution.set(N.width,N.height),M.visible=!1,D.autoClear=!0,k&&(k.visible=R.visualization.displayMesh),D.setRenderTarget(N),D.render(T,E),D.setRenderTarget(null),P.render(D),D.autoClear=!1,M.visible=R.benchmark.displayRays,k&&D.render(k,E),D.render(M,E)}U();
//# sourceMappingURL=inspector-D1NGg3AL.js.map