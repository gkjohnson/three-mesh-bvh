const nodeModules = location.href + '/../../node_modules/';
const imports = {
  "three": nodeModules + "three/src/Three.js",
  "three/": nodeModules + "three/",
  "stats.js": nodeModules + "stats.js/src/Stats.js"
};
const importmap = document.createElement("script");
importmap.type = "importmap";
importmap.textContent = JSON.stringify({imports});
const dom = document.body || document.head;
if (!dom) {
  throw new Error("neither <body> nor <head> available to append importmap");
}
dom.append(importmap);
