import { uint } from 'three/tsl';

export const BVH_STACK_DEPTH = uint( 60 );

// Leaf range callback results. STOP_TRAVERSAL reports a hit and ends the entire shapecast.
export const NOT_INTERSECTED = uint( 0 );
export const INTERSECTED = uint( 1 );
export const STOP_TRAVERSAL = uint( 2 );
