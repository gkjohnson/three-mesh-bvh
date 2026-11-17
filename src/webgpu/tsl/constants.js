import { ConstNode } from 'three/webgpu';

// a const node rather than "uint( 60 )", which wraps the value in a node without a readable "value"
export const BVH_STACK_DEPTH = /* @__PURE__ */ new ConstNode( 60, 'uint' );
