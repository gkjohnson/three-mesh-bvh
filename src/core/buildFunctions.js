import { BufferAttribute } from 'three';
import { MeshBVHNode } from './MeshBVHNode.js';
import { getLongestEdgeIndex, computeSurfaceArea, copyBounds, unionBounds, expandByTriangleBounds } from '../utils/ArrayBoxUtilities.js';
import {
	CENTER, AVERAGE, SAH, TRIANGLE_INTERSECT_COST, TRAVERSAL_COST,
	BYTES_PER_NODE, FLOAT32_EPSILON, IS_LEAFNODE_FLAG,
} from './Constants.js';

function ensureIndex( geo, options ) {

	if ( ! geo.index ) {

		const vertexCount = geo.attributes.position.count;
		const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
		let index;
		if ( vertexCount > 65535 ) {

			index = new Uint32Array( new BufferConstructor( 4 * vertexCount ) );

		} else {

			index = new Uint16Array( new BufferConstructor( 2 * vertexCount ) );

		}

		geo.setIndex( new BufferAttribute( index, 1 ) );

		for ( let i = 0; i < vertexCount; i ++ ) {

			index[ i ] = i;

		}

	}

}

// Computes the set of { offset, count } ranges which need independent BVH roots. Each
// region in the geometry index that belongs to a different set of material groups requires
// a separate BVH root, so that triangles indices belonging to one group never get swapped
// with triangle indices belongs to another group. For example, if the groups were like this:
//
// [-------------------------------------------------------------]
// |__________________|
//   g0 = [0, 20]  |______________________||_____________________|
//                      g1 = [16, 40]           g2 = [41, 60]
//
// we would need four BVH roots: [0, 15], [16, 20], [21, 40], [41, 60].
function getRootIndexRanges( geo ) {

	if ( ! geo.groups || ! geo.groups.length ) {

		return [ { offset: 0, count: geo.index.count / 3 } ];

	}

	const ranges = [];
	const rangeBoundaries = new Set();
	for ( const group of geo.groups ) {

		rangeBoundaries.add( group.start );
		rangeBoundaries.add( group.start + group.count );

	}

	// note that if you don't pass in a comparator, it sorts them lexicographically as strings :-(
	const sortedBoundaries = Array.from( rangeBoundaries.values() ).sort( ( a, b ) => a - b );
	for ( let i = 0; i < sortedBoundaries.length - 1; i ++ ) {

		const start = sortedBoundaries[ i ], end = sortedBoundaries[ i + 1 ];
		ranges.push( { offset: ( start / 3 ), count: ( end - start ) / 3 } );

	}

	return ranges;

}

// computes the union of the bounds of all of the given triangles and puts the resulting box in target. If
// centroidTarget is provided then a bounding box is computed for the centroids of the triangles, as well.
// These are computed together to avoid redundant accesses to bounds array.
function getBounds( triangleBounds, offset, count, target, centroidTarget = null ) {

	let minx = Infinity;
	let miny = Infinity;
	let minz = Infinity;
	let maxx = - Infinity;
	let maxy = - Infinity;
	let maxz = - Infinity;

	let cminx = Infinity;
	let cminy = Infinity;
	let cminz = Infinity;
	let cmaxx = - Infinity;
	let cmaxy = - Infinity;
	let cmaxz = - Infinity;

	const includeCentroid = centroidTarget !== null;
	for ( let i = offset * 6, end = ( offset + count ) * 6; i < end; i += 6 ) {

		const cx = triangleBounds[ i + 0 ];
		const hx = triangleBounds[ i + 1 ];
		const lx = cx - hx;
		const rx = cx + hx;
		if ( lx < minx ) minx = lx;
		if ( rx > maxx ) maxx = rx;
		if ( includeCentroid && cx < cminx ) cminx = cx;
		if ( includeCentroid && cx > cmaxx ) cmaxx = cx;

		const cy = triangleBounds[ i + 2 ];
		const hy = triangleBounds[ i + 3 ];
		const ly = cy - hy;
		const ry = cy + hy;
		if ( ly < miny ) miny = ly;
		if ( ry > maxy ) maxy = ry;
		if ( includeCentroid && cy < cminy ) cminy = cy;
		if ( includeCentroid && cy > cmaxy ) cmaxy = cy;

		const cz = triangleBounds[ i + 4 ];
		const hz = triangleBounds[ i + 5 ];
		const lz = cz - hz;
		const rz = cz + hz;
		if ( lz < minz ) minz = lz;
		if ( rz > maxz ) maxz = rz;
		if ( includeCentroid && cz < cminz ) cminz = cz;
		if ( includeCentroid && cz > cmaxz ) cmaxz = cz;

	}

	target[ 0 ] = minx;
	target[ 1 ] = miny;
	target[ 2 ] = minz;

	target[ 3 ] = maxx;
	target[ 4 ] = maxy;
	target[ 5 ] = maxz;

	if ( includeCentroid ) {

		centroidTarget[ 0 ] = cminx;
		centroidTarget[ 1 ] = cminy;
		centroidTarget[ 2 ] = cminz;

		centroidTarget[ 3 ] = cmaxx;
		centroidTarget[ 4 ] = cmaxy;
		centroidTarget[ 5 ] = cmaxz;

	}

}

// A stand alone function for retrieving the centroid bounds.
function getCentroidBounds( triangleBounds, offset, count, centroidTarget ) {

	let cminx = Infinity;
	let cminy = Infinity;
	let cminz = Infinity;
	let cmaxx = - Infinity;
	let cmaxy = - Infinity;
	let cmaxz = - Infinity;

	for ( let i = offset * 6, end = ( offset + count ) * 6; i < end; i += 6 ) {

		const cx = triangleBounds[ i + 0 ];
		if ( cx < cminx ) cminx = cx;
		if ( cx > cmaxx ) cmaxx = cx;

		const cy = triangleBounds[ i + 2 ];
		if ( cy < cminy ) cminy = cy;
		if ( cy > cmaxy ) cmaxy = cy;

		const cz = triangleBounds[ i + 4 ];
		if ( cz < cminz ) cminz = cz;
		if ( cz > cmaxz ) cmaxz = cz;

	}

	centroidTarget[ 0 ] = cminx;
	centroidTarget[ 1 ] = cminy;
	centroidTarget[ 2 ] = cminz;

	centroidTarget[ 3 ] = cmaxx;
	centroidTarget[ 4 ] = cmaxy;
	centroidTarget[ 5 ] = cmaxz;

}


// reorders `tris` such that for `count` elements after `offset`, elements on the left side of the split
// will be on the left and elements on the right side of the split will be on the right. returns the index
// of the first element on the right side, or offset + count if there are no elements on the right side.
function partition( index, triangleBounds, offset, count, split ) {

	let left = offset;
	let right = offset + count - 1;
	const pos = split.pos;
	const axisOffset = split.axis * 2;

	// hoare partitioning, see e.g. https://en.wikipedia.org/wiki/Quicksort#Hoare_partition_scheme
	while ( true ) {

		while ( left <= right && triangleBounds[ left * 6 + axisOffset ] < pos ) {

			left ++;

		}


		// if a triangle center lies on the partition plane it is considered to be on the right side
		while ( left <= right && triangleBounds[ right * 6 + axisOffset ] >= pos ) {

			right --;

		}

		if ( left < right ) {

			// we need to swap all of the information associated with the triangles at index
			// left and right; that's the verts in the geometry index, the bounds,
			// and perhaps the SAH planes

			for ( let i = 0; i < 3; i ++ ) {

				let t0 = index[ left * 3 + i ];
				index[ left * 3 + i ] = index[ right * 3 + i ];
				index[ right * 3 + i ] = t0;

				let t1 = triangleBounds[ left * 6 + i * 2 + 0 ];
				triangleBounds[ left * 6 + i * 2 + 0 ] = triangleBounds[ right * 6 + i * 2 + 0 ];
				triangleBounds[ right * 6 + i * 2 + 0 ] = t1;

				let t2 = triangleBounds[ left * 6 + i * 2 + 1 ];
				triangleBounds[ left * 6 + i * 2 + 1 ] = triangleBounds[ right * 6 + i * 2 + 1 ];
				triangleBounds[ right * 6 + i * 2 + 1 ] = t2;

			}

			left ++;
			right --;

		} else {

			return left;

		}

	}

}

const BIN_COUNT = 32;
const binsSort = ( a, b ) => a.candidate - b.candidate;
const sahBins = new Array( BIN_COUNT ).fill().map( () => {

	return {

		count: 0,
		bounds: new Float32Array( 6 ),
		rightCacheBounds: new Float32Array( 6 ),
		leftCacheBounds: new Float32Array( 6 ),
		candidate: 0,

	};

} );
const leftBounds = new Float32Array( 6 );

function getOptimalSplit( nodeBoundingData, centroidBoundingData, triangleBounds, offset, count, strategy ) {

	let axis = - 1;
	let pos = 0;

	// Center
	if ( strategy === CENTER ) {

		axis = getLongestEdgeIndex( centroidBoundingData );
		if ( axis !== - 1 ) {

			pos = ( centroidBoundingData[ axis ] + centroidBoundingData[ axis + 3 ] ) / 2;

		}

	} else if ( strategy === AVERAGE ) {

		axis = getLongestEdgeIndex( nodeBoundingData );
		if ( axis !== - 1 ) {

			pos = getAverage( triangleBounds, offset, count, axis );

		}

	} else if ( strategy === SAH ) {

		const rootSurfaceArea = computeSurfaceArea( nodeBoundingData );
		let bestCost = TRIANGLE_INTERSECT_COST * count;

		// iterate over all axes
		const cStart = offset * 6;
		const cEnd = ( offset + count ) * 6;
		for ( let a = 0; a < 3; a ++ ) {

			const axisLeft = centroidBoundingData[ a ];
			const axisRight = centroidBoundingData[ a + 3 ];
			const axisLength = axisRight - axisLeft;
			const binWidth = axisLength / BIN_COUNT;

			// If we have fewer triangles than we're planning to split then just check all
			// the triangle positions because it will be faster.
			if ( count < BIN_COUNT / 4 ) {

				// initialize the bin candidates
				const truncatedBins = [ ...sahBins ];
				truncatedBins.length = count;

				// set the candidates
				let b = 0;
				for ( let c = cStart; c < cEnd; c += 6, b ++ ) {

					const bin = truncatedBins[ b ];
					bin.candidate = triangleBounds[ c + 2 * a ];
					bin.count = 0;

					const {
						bounds,
						leftCacheBounds,
						rightCacheBounds,
					} = bin;
					for ( let d = 0; d < 3; d ++ ) {

						rightCacheBounds[ d ] = Infinity;
						rightCacheBounds[ d + 3 ] = - Infinity;

						leftCacheBounds[ d ] = Infinity;
						leftCacheBounds[ d + 3 ] = - Infinity;

						bounds[ d ] = Infinity;
						bounds[ d + 3 ] = - Infinity;

					}

					expandByTriangleBounds( c, triangleBounds, bounds );

				}

				truncatedBins.sort( binsSort );

				// remove redundant splits
				let splitCount = count;
				for ( let bi = 0; bi < splitCount; bi ++ ) {

					const bin = truncatedBins[ bi ];
					while ( bi + 1 < splitCount && truncatedBins[ bi + 1 ].candidate === bin.candidate ) {

						truncatedBins.splice( bi + 1, 1 );
						splitCount --;

					}

				}

				// find the appropriate bin for each triangle and expand the bounds.
				for ( let c = cStart; c < cEnd; c += 6 ) {

					const center = triangleBounds[ c + 2 * a ];
					for ( let bi = 0; bi < splitCount; bi ++ ) {

						const bin = truncatedBins[ bi ];
						if ( center >= bin.candidate ) {

							expandByTriangleBounds( c, triangleBounds, bin.rightCacheBounds );

						} else {

							expandByTriangleBounds( c, triangleBounds, bin.leftCacheBounds );
							bin.count ++;

						}

					}

				}

				// expand all the bounds
				for ( let bi = 0; bi < splitCount; bi ++ ) {

					const bin = truncatedBins[ bi ];
					const leftCount = bin.count;
					const rightCount = count - bin.count;

					// check the cost of this split
					const leftBounds = bin.leftCacheBounds;
					const rightBounds = bin.rightCacheBounds;

					let leftProb = 0;
					if ( leftCount !== 0 ) {

						leftProb = computeSurfaceArea( leftBounds ) / rootSurfaceArea;

					}

					let rightProb = 0;
					if ( rightCount !== 0 ) {

						rightProb = computeSurfaceArea( rightBounds ) / rootSurfaceArea;

					}

					const cost = TRAVERSAL_COST + TRIANGLE_INTERSECT_COST * (
						leftProb * leftCount + rightProb * rightCount
					);

					if ( cost < bestCost ) {

						axis = a;
						bestCost = cost;
						pos = bin.candidate;

					}

				}

			} else {

				// reset the bins
				for ( let i = 0; i < BIN_COUNT; i ++ ) {

					const bin = sahBins[ i ];
					bin.count = 0;
					bin.candidate = axisLeft + binWidth + i * binWidth;

					const bounds = bin.bounds;
					for ( let d = 0; d < 3; d ++ ) {

						bounds[ d ] = Infinity;
						bounds[ d + 3 ] = - Infinity;

					}

				}

				// iterate over all center positions
				for ( let c = cStart; c < cEnd; c += 6 ) {

					const triCenter = triangleBounds[ c + 2 * a ];
					const relativeCenter = triCenter - axisLeft;

					// in the partition function if the centroid lies on the split plane then it is
					// considered to be on the right side of the split
					let binIndex = ~ ~ ( relativeCenter / binWidth );
					if ( binIndex >= BIN_COUNT ) binIndex = BIN_COUNT - 1;

					const bin = sahBins[ binIndex ];
					bin.count ++;

					expandByTriangleBounds( c, triangleBounds, bin.bounds );

				}

				// cache the unioned bounds from right to left so we don't have to regenerate them each time
				const lastBin = sahBins[ BIN_COUNT - 1 ];
				copyBounds( lastBin.bounds, lastBin.rightCacheBounds );
				for ( let i = BIN_COUNT - 2; i >= 0; i -- ) {

					const bin = sahBins[ i ];
					const nextBin = sahBins[ i + 1 ];
					unionBounds( bin.bounds, nextBin.rightCacheBounds, bin.rightCacheBounds );

				}

				let leftCount = 0;
				for ( let i = 0; i < BIN_COUNT - 1; i ++ ) {

					const bin = sahBins[ i ];
					const binCount = bin.count;
					const bounds = bin.bounds;

					const nextBin = sahBins[ i + 1 ];
					const rightBounds = nextBin.rightCacheBounds;

					// dont do anything with the bounds if the new bounds have no triangles
					if ( binCount !== 0 ) {

						if ( leftCount === 0 ) {

							copyBounds( bounds, leftBounds );

						} else {

							unionBounds( bounds, leftBounds, leftBounds );

						}

					}

					leftCount += binCount;

					// check the cost of this split
					let leftProb = 0;
					let rightProb = 0;

					if ( leftCount !== 0 ) {

						leftProb = computeSurfaceArea( leftBounds ) / rootSurfaceArea;

					}

					const rightCount = count - leftCount;
					if ( rightCount !== 0 ) {

						rightProb = computeSurfaceArea( rightBounds ) / rootSurfaceArea;

					}

					const cost = TRAVERSAL_COST + TRIANGLE_INTERSECT_COST * (
						leftProb * leftCount + rightProb * rightCount
					);

					if ( cost < bestCost ) {

						axis = a;
						bestCost = cost;
						pos = bin.candidate;

					}

				}

			}

		}

	} else {

		console.warn( `MeshBVH: Invalid build strategy value ${ strategy } used.` );

	}

	return { axis, pos };

}

// returns the average coordinate on the specified axis of the all the provided triangles
function getAverage( triangleBounds, offset, count, axis ) {

	let avg = 0;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		avg += triangleBounds[ i * 6 + axis * 2 ];

	}

	return avg / count;

}

// precomputes the bounding box for each triangle; required for quickly calculating tree splits.
// result is an array of size tris.length * 6 where triangle i maps to a
// [x_center, x_delta, y_center, y_delta, z_center, z_delta] tuple starting at index i * 6,
// representing the center and half-extent in each dimension of triangle i
function computeTriangleBounds( geo, fullBounds ) {

	const posAttr = geo.attributes.position;
	const index = geo.index.array;
	const triCount = index.length / 3;
	const triangleBounds = new Float32Array( triCount * 6 );
	const normalized = posAttr.normalized;

	// used for non-normalized positions
	const posArr = posAttr.array;

	// support for an interleaved position buffer
	const bufferOffset = posAttr.offset || 0;
	let stride = 3;
	if ( posAttr.isInterleavedBufferAttribute ) {

		stride = posAttr.data.stride;

	}

	// used for normalized positions
	const getters = [ 'getX', 'getY', 'getZ' ];

	for ( let tri = 0; tri < triCount; tri ++ ) {

		const tri3 = tri * 3;
		const tri6 = tri * 6;

		let ai, bi, ci;

		if ( normalized ) {

			ai = index[ tri3 + 0 ];
			bi = index[ tri3 + 1 ];
			ci = index[ tri3 + 2 ];

		} else {

			ai = index[ tri3 + 0 ] * stride + bufferOffset;
			bi = index[ tri3 + 1 ] * stride + bufferOffset;
			ci = index[ tri3 + 2 ] * stride + bufferOffset;

		}

		for ( let el = 0; el < 3; el ++ ) {

			let a, b, c;

			if ( normalized ) {

				a = posAttr[ getters[ el ] ]( ai );
				b = posAttr[ getters[ el ] ]( bi );
				c = posAttr[ getters[ el ] ]( ci );

			} else {

				a = posArr[ ai + el ];
				b = posArr[ bi + el ];
				c = posArr[ ci + el ];

			}

			let min = a;
			if ( b < min ) min = b;
			if ( c < min ) min = c;

			let max = a;
			if ( b > max ) max = b;
			if ( c > max ) max = c;

			// Increase the bounds size by float32 epsilon to avoid precision errors when
			// converting to 32 bit float. Scale the epsilon by the size of the numbers being
			// worked with.
			const halfExtents = ( max - min ) / 2;
			const el2 = el * 2;
			triangleBounds[ tri6 + el2 + 0 ] = min + halfExtents;
			triangleBounds[ tri6 + el2 + 1 ] = halfExtents + ( Math.abs( min ) + halfExtents ) * FLOAT32_EPSILON;

			if ( min < fullBounds[ el ] ) fullBounds[ el ] = min;
			if ( max > fullBounds[ el + 3 ] ) fullBounds[ el + 3 ] = max;

		}

	}

	return triangleBounds;

}

export function buildTree( geo, options ) {

	function triggerProgress( trianglesProcessed ) {

		if ( onProgress ) {

			onProgress( trianglesProcessed / totalTriangles );

		}

	}

	// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
	// recording the offset and count of its triangles and writing them into the reordered geometry index.
	function splitNode( node, offset, count, centroidBoundingData = null, depth = 0 ) {

		if ( ! reachedMaxDepth && depth >= maxDepth ) {

			reachedMaxDepth = true;
			if ( verbose ) {

				console.warn( `MeshBVH: Max depth of ${ maxDepth } reached when generating BVH. Consider increasing maxDepth.` );
				console.warn( geo );

			}

		}

		// early out if we've met our capacity
		if ( count <= maxLeafTris || depth >= maxDepth ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;
			return node;

		}

		// Find where to split the volume
		const split = getOptimalSplit( node.boundingData, centroidBoundingData, triangleBounds, offset, count, strategy );
		if ( split.axis === - 1 ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;
			return node;

		}

		const splitOffset = partition( indexArray, triangleBounds, offset, count, split );

		// create the two new child nodes
		if ( splitOffset === offset || splitOffset === offset + count ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;

		} else {

			node.splitAxis = split.axis;

			// create the left child and compute its bounding box
			const left = new MeshBVHNode();
			const lstart = offset;
			const lcount = splitOffset - offset;
			node.left = left;
			left.boundingData = new Float32Array( 6 );

			getBounds( triangleBounds, lstart, lcount, left.boundingData, cacheCentroidBoundingData );
			splitNode( left, lstart, lcount, cacheCentroidBoundingData, depth + 1 );

			// repeat for right
			const right = new MeshBVHNode();
			const rstart = splitOffset;
			const rcount = count - lcount;
			node.right = right;
			right.boundingData = new Float32Array( 6 );

			getBounds( triangleBounds, rstart, rcount, right.boundingData, cacheCentroidBoundingData );
			splitNode( right, rstart, rcount, cacheCentroidBoundingData, depth + 1 );

		}

		return node;

	}

	ensureIndex( geo, options );

	// Compute the full bounds of the geometry at the same time as triangle bounds because
	// we'll need it for the root bounds in the case with no groups and it should be fast here.
	// We can't use the geometrying bounding box if it's available because it may be out of date.
	const fullBounds = new Float32Array( 6 );
	const cacheCentroidBoundingData = new Float32Array( 6 );
	const triangleBounds = computeTriangleBounds( geo, fullBounds );
	const indexArray = geo.index.array;
	const maxDepth = options.maxDepth;
	const verbose = options.verbose;
	const maxLeafTris = options.maxLeafTris;
	const strategy = options.strategy;
	const onProgress = options.onProgress;
	const totalTriangles = geo.index.count / 3;
	let reachedMaxDepth = false;

	const roots = [];
	const ranges = getRootIndexRanges( geo );

	if ( ranges.length === 1 ) {

		const range = ranges[ 0 ];
		const root = new MeshBVHNode();
		root.boundingData = fullBounds;
		getCentroidBounds( triangleBounds, range.offset, range.count, cacheCentroidBoundingData );

		splitNode( root, range.offset, range.count, cacheCentroidBoundingData );
		roots.push( root );

	} else {

		for ( let range of ranges ) {

			const root = new MeshBVHNode();
			root.boundingData = new Float32Array( 6 );
			getBounds( triangleBounds, range.offset, range.count, root.boundingData, cacheCentroidBoundingData );

			splitNode( root, range.offset, range.count, cacheCentroidBoundingData );
			roots.push( root );

		}

	}

	return roots;

}

export function buildPackedTree( geo, options ) {

	// boundingData  				: 6 float32
	// right / offset 				: 1 uint32
	// splitAxis / isLeaf + count 	: 1 uint32 / 2 uint16
	const roots = buildTree( geo, options );

	let float32Array;
	let uint32Array;
	let uint16Array;
	const packedRoots = [];
	const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
	for ( let i = 0; i < roots.length; i ++ ) {

		const root = roots[ i ];
		let nodeCount = countNodes( root );

		const buffer = new BufferConstructor( BYTES_PER_NODE * nodeCount );
		float32Array = new Float32Array( buffer );
		uint32Array = new Uint32Array( buffer );
		uint16Array = new Uint16Array( buffer );
		populateBuffer( 0, root );
		packedRoots.push( buffer );

	}

	return packedRoots;

	function countNodes( node ) {

		if ( node.count ) {

			return 1;

		} else {

			return 1 + countNodes( node.left ) + countNodes( node.right );

		}

	}

	function populateBuffer( byteOffset, node ) {

		const stride4Offset = byteOffset / 4;
		const stride2Offset = byteOffset / 2;
		const isLeaf = ! ! node.count;
		const boundingData = node.boundingData;
		for ( let i = 0; i < 6; i ++ ) {

			float32Array[ stride4Offset + i ] = boundingData[ i ];

		}

		if ( isLeaf ) {

			const offset = node.offset;
			const count = node.count;
			uint32Array[ stride4Offset + 6 ] = offset;
			uint16Array[ stride2Offset + 14 ] = count;
			uint16Array[ stride2Offset + 15 ] = IS_LEAFNODE_FLAG;
			return byteOffset + BYTES_PER_NODE;

		} else {

			const left = node.left;
			const right = node.right;
			const splitAxis = node.splitAxis;

			let nextUnusedPointer;
			nextUnusedPointer = populateBuffer( byteOffset + BYTES_PER_NODE, left );

			if ( ( nextUnusedPointer / 4 ) > Math.pow( 2, 32 ) ) {

				throw new Error( 'MeshBVH: Cannot store child pointer greater than 32 bits.' );

			}

			uint32Array[ stride4Offset + 6 ] = nextUnusedPointer / 4;
			nextUnusedPointer = populateBuffer( nextUnusedPointer, right );

			uint32Array[ stride4Offset + 7 ] = splitAxis;
			return nextUnusedPointer;

		}

	}

}
