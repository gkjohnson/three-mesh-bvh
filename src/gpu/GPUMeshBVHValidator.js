/**
 * Validation utilities for GPUMeshBVH
 * Helps catch correctness issues in sorting, BVH structure, and traversal
 */

const INVALID_IDX = 0xFFFFFFFF;

export class GPUMeshBVHValidator {

	constructor( gpuBVH ) {

		this.gpuBVH = gpuBVH;
		this.device = gpuBVH.device;

	}

	/**
	 * Validate that morton codes are sorted correctly
	 *
	 * NOTE: This validation runs after the full build, so clusterIdx has been
	 * modified by H-PLOC (contains internal node indices, not original primitive indices).
	 * We can only verify sorting ORDER (mortonCodes[i] <= mortonCodes[i+1]).
	 * Sort STABILITY cannot be verified post-build as original clusterIdx values are gone.
	 *
	 * @returns {Promise<{valid: boolean, errors: string[], stats: object}>}
	 */
	async validateSort() {

		const errors = [];
		const stats = {
			primCount: this.gpuBVH._primCount,
			outOfOrderCount: 0,
			duplicateMortonCodes: 0,
		};

		const primCount = this.gpuBVH._primCount;
		if ( primCount === 0 ) {

			return { valid: true, errors: [], stats };

		}

		// Check OneSweep shader status if using OneSweep sorter
		const sorter = this.gpuBVH.sorter;
		if ( sorter && typeof sorter.readStatus === 'function' ) {

			const status = await sorter.readStatus();
			stats.sorterSubgroupSize = sorter.subgroupSize;
			stats.sorterShaderVariant = sorter.shaderVariant;

			if ( status.hasErrors ) {

				if ( status.globalHist !== 0 ) {

					errors.push( `OneSweep global_hist shader error: 0x${status.globalHist.toString( 16 )} (subgroup size check failed)` );

				}

				if ( status.scan !== 0 ) {

					errors.push( `OneSweep scan shader error: 0x${status.scan.toString( 16 )} (subgroup size check failed)` );

				}

				if ( status.pass !== 0 ) {

					errors.push( `OneSweep pass shader error: 0x${status.pass.toString( 16 )} (subgroup hist capacity exceeded)` );

				}

			}

			// Read passHist to verify scan output (FLAG_INCLUSIVE with correct prefixes)
			if ( typeof sorter.readPassHist === 'function' ) {

				const passHist = await sorter.readPassHist();
				if ( passHist ) {

					const FLAG_INCLUSIVE = 2;
					const FLAG_MASK = 3;
					let scanErrors = 0;

					// Check each pass's scan output
					for ( let pass = 0; pass < 4; pass ++ ) {

						const data = passHist[ `pass${pass}` ];
						let lastPrefix = - 1;

						for ( let digit = 0; digit < 256; digit ++ ) {

							const entry = data[ digit ];
							const flag = entry & FLAG_MASK;
							const prefix = entry >> 2;

							// Check flag is FLAG_INCLUSIVE
							if ( flag !== FLAG_INCLUSIVE ) {

								scanErrors ++;
								if ( scanErrors <= 3 ) {

									errors.push( `Pass ${pass} digit ${digit}: wrong flag ${flag} (expected ${FLAG_INCLUSIVE}), raw=0x${entry.toString( 16 )}` );

								}

							}

							// Check prefix is monotonically increasing (prefix sum)
							if ( lastPrefix >= 0 && prefix < lastPrefix ) {

								scanErrors ++;
								if ( scanErrors <= 3 ) {

									errors.push( `Pass ${pass} digit ${digit}: prefix ${prefix} < previous ${lastPrefix} (not monotonic)` );

								}

							}

							lastPrefix = prefix;

						}

						// Log the final prefix for debugging (should be close to primCount)
						stats[ `pass${pass}FinalPrefix` ] = lastPrefix;

					}

					stats.scanErrors = scanErrors;

				}

			}

		}

		// Read back morton codes (clusterIdx not needed - modified by H-PLOC)
		const mortonCodes = await this._readBuffer(
			this.gpuBVH._buildBuffers.mortonCodes,
			primCount * 4,
			Uint32Array
		);

		// Check sorting: mortonCodes[i] <= mortonCodes[i+1]
		// Also track which passes might have caused errors (based on which bits differ)
		const PART_SIZE = 256 * 15; // OneSweep partition size (BLOCK_DIM * KEYS_PER_THREAD)
		const threadBlocks = Math.ceil( primCount / PART_SIZE );
		stats.partitionSize = PART_SIZE;
		stats.threadBlocks = threadBlocks;
		for ( let i = 0; i < primCount - 1; i ++ ) {

			if ( mortonCodes[ i ] > mortonCodes[ i + 1 ] ) {

				stats.outOfOrderCount ++;
				if ( stats.outOfOrderCount <= 10 ) {

					const m0 = mortonCodes[ i ];
					const m1 = mortonCodes[ i + 1 ];

					// Analyze which radix pass might have caused this
					const digit0 = [ m0 & 0xFF, ( m0 >> 8 ) & 0xFF, ( m0 >> 16 ) & 0xFF, ( m0 >> 24 ) & 0xFF ];
					const digit1 = [ m1 & 0xFF, ( m1 >> 8 ) & 0xFF, ( m1 >> 16 ) & 0xFF, ( m1 >> 24 ) & 0xFF ];

					// Find which pass is responsible (highest differing digit)
					let faultyPass = - 1;
					for ( let p = 3; p >= 0; p -- ) {

						if ( digit0[ p ] !== digit1[ p ] ) {

							faultyPass = p;
							break;

						}

					}

					// Check workgroup boundary (OneSweep partition boundary)
					const partId = Math.floor( i / PART_SIZE );

					errors.push(
						`Sort error at index ${i} (partId=${partId}): ` +
						`morton[${i}]=0x${m0.toString( 16 ).padStart( 8, '0' )} > morton[${i + 1}]=0x${m1.toString( 16 ).padStart( 8, '0' )} ` +
						`(digits=[${digit0.join( ',' )}] vs [${digit1.join( ',' )}], likely pass ${faultyPass})`
					);

				}

			}

		}

		// Check for duplicate or missing indices (indicates collision in scatter)
		// Read clusterIdx which should be a permutation of 0..primCount-1 after sort
		// Note: This won't work post-H-PLOC as clusterIdx is modified
		// We can only do this check if we run sort in isolation

		// Count duplicate morton codes (useful for understanding tree structure)
		let duplicateStart = 0;
		for ( let i = 1; i <= primCount; i ++ ) {

			const endOfRun = ( i === primCount ) || ( mortonCodes[ i ] !== mortonCodes[ duplicateStart ] );

			if ( endOfRun ) {

				const runLength = i - duplicateStart;
				if ( runLength > 1 ) {

					stats.duplicateMortonCodes += runLength;

				}

				duplicateStart = i;

			}

		}

		if ( stats.outOfOrderCount > 5 ) {

			errors.push( `... and ${stats.outOfOrderCount - 5} more sorting errors` );

		}

		// Validity is based solely on sorting order (stability cannot be verified post-H-PLOC)
		return {
			valid: stats.outOfOrderCount === 0,
			errors,
			stats,
		};

	}

	/**
	 * Validate BVH structural integrity
	 * Call after H-PLOC build completes
	 * @returns {Promise<{valid: boolean, errors: string[], stats: object}>}
	 */
	async validateBVH() {

		const errors = [];
		const stats = {
			nodeCount: this.gpuBVH._nodeCount,
			primCount: this.gpuBVH._primCount,
			rootIndex: this.gpuBVH._rootIndex,
			internalNodes: 0,
			leafNodes: 0,
			maxDepth: 0,
			boundsErrors: 0,
			childIndexErrors: 0,
			unreachableNodes: 0,
		};

		const primCount = this.gpuBVH._primCount;
		const nodeCount = this.gpuBVH._nodeCount;
		const rootIndex = this.gpuBVH._rootIndex;

		if ( primCount === 0 ) {

			return { valid: true, errors: [], stats };

		}

		// Validate root index
		if ( rootIndex >= nodeCount ) {

			errors.push( `Root index ${rootIndex} out of range [0, ${nodeCount})` );
			return { valid: false, errors, stats };

		}

		// Read back BVH2 nodes
		// Layout: bounds (6 floats = 24 bytes) + leftChild (4 bytes) + rightChild (4 bytes) = 32 bytes
		const nodeData = await this._readBuffer(
			this.gpuBVH._buildBuffers.bvh2Nodes,
			nodeCount * 32,
			ArrayBuffer
		);

		const nodes = this._parseBVH2Nodes( nodeData, nodeCount );

		// Track which nodes are reachable from root
		const visited = new Set();

		// Validate tree structure via DFS from root
		const stack = [ { nodeIdx: rootIndex, depth: 0 } ];

		while ( stack.length > 0 ) {

			const { nodeIdx, depth } = stack.pop();

			if ( visited.has( nodeIdx ) ) {

				errors.push( `Cycle detected: node ${nodeIdx} visited twice` );
				continue;

			}

			visited.add( nodeIdx );
			stats.maxDepth = Math.max( stats.maxDepth, depth );

			const node = nodes[ nodeIdx ];
			const isLeaf = node.leftChild === INVALID_IDX;

			if ( isLeaf ) {

				stats.leafNodes ++;

				// Validate leaf: rightChild is primitive index
				if ( node.rightChild >= primCount ) {

					stats.childIndexErrors ++;
					if ( stats.childIndexErrors <= 5 ) {

						errors.push(
							`Leaf ${nodeIdx}: primIdx ${node.rightChild} >= primCount ${primCount}`
						);

					}

				}

			} else {

				stats.internalNodes ++;

				// Validate internal node: both children in range
				if ( node.leftChild >= nodeCount ) {

					stats.childIndexErrors ++;
					if ( stats.childIndexErrors <= 5 ) {

						errors.push(
							`Internal node ${nodeIdx}: leftChild ${node.leftChild} >= nodeCount ${nodeCount}`
						);

					}

				}

				if ( node.rightChild >= nodeCount ) {

					stats.childIndexErrors ++;
					if ( stats.childIndexErrors <= 5 ) {

						errors.push(
							`Internal node ${nodeIdx}: rightChild ${node.rightChild} >= nodeCount ${nodeCount}`
						);

					}

				}

				// Validate bounds containment
				if ( node.leftChild < nodeCount ) {

					const leftChild = nodes[ node.leftChild ];
					if ( ! this._boundsContain( node.bounds, leftChild.bounds ) ) {

						stats.boundsErrors ++;
						if ( stats.boundsErrors <= 5 ) {

							errors.push(
								`Node ${nodeIdx}: bounds do not contain left child ${node.leftChild}`
							);

						}

					}

					stack.push( { nodeIdx: node.leftChild, depth: depth + 1 } );

				}

				if ( node.rightChild < nodeCount ) {

					const rightChild = nodes[ node.rightChild ];
					if ( ! this._boundsContain( node.bounds, rightChild.bounds ) ) {

						stats.boundsErrors ++;
						if ( stats.boundsErrors <= 5 ) {

							errors.push(
								`Node ${nodeIdx}: bounds do not contain right child ${node.rightChild}`
							);

						}

					}

					stack.push( { nodeIdx: node.rightChild, depth: depth + 1 } );

				}

			}

		}

		// Check for unreachable nodes
		stats.unreachableNodes = nodeCount - visited.size;
		if ( stats.unreachableNodes > 0 ) {

			errors.push( `${stats.unreachableNodes} nodes unreachable from root` );

		}

		// Summarize truncated errors
		if ( stats.childIndexErrors > 5 ) {

			errors.push( `... and ${stats.childIndexErrors - 5} more child index errors` );

		}

		if ( stats.boundsErrors > 5 ) {

			errors.push( `... and ${stats.boundsErrors - 5} more bounds containment errors` );

		}

		const valid = stats.childIndexErrors === 0 &&
			stats.boundsErrors === 0 &&
			stats.unreachableNodes === 0;

		return { valid, errors, stats };

	}

	/**
	 * Cross-check GPU BVH intersections against CPU reference
	 * @param {MeshBVH} cpuBVH - CPU-built BVH from three-mesh-bvh
	 * @param {Array<{origin: Vector3, direction: Vector3}>} rays - Test rays
	 * @param {Function} gpuIntersectFn - Function that takes rays and returns GPU hit results
	 * @returns {Promise<{valid: boolean, errors: string[], stats: object}>}
	 */
	async validateIntersections( cpuBVH, rays, _gpuIntersectFn ) {

		void _gpuIntersectFn;
		const errors = [];
		const stats = {
			rayCount: rays.length,
			mismatches: 0,
			cpuHits: 0,
			gpuHits: 0,
		};

		// This requires integration with the specific traversal implementation
		// For now, provide the interface - implementation depends on how GPU traversal is exposed

		errors.push( 'Intersection validation not yet implemented - requires GPU traversal integration' );

		return { valid: false, errors, stats };

	}

	/**
	 * Run all validations
	 * @returns {Promise<{sort: object, bvh: object}>}
	 */
	async validateAll() {

		const sortResult = await this.validateSort();
		const bvhResult = await this.validateBVH();

		return {
			sort: sortResult,
			bvh: bvhResult,
		};

	}

	/**
	 * Test the sorter in isolation with known data.
	 * Creates test data, sorts it, and verifies both keys and payload.
	 * @param {number} count - Number of elements to sort (default: use primCount)
	 * @returns {Promise<{valid: boolean, errors: string[], stats: object}>}
	 */
	async validateSorterIsolated( count = null ) {

		const errors = [];
		const stats = {
			count: count || this.gpuBVH._primCount,
			keysOutOfOrder: 0,
			payloadDuplicates: 0,
			payloadMissing: 0,
		};

		const primCount = stats.count;
		if ( primCount === 0 ) {

			return { valid: true, errors: [], stats };

		}

		const sorter = this.gpuBVH.sorter;
		if ( ! sorter ) {

			errors.push( 'No external sorter available (using builtin sort)' );
			return { valid: false, errors, stats };

		}

		const device = this.device;

		// Create test buffers
		const keysBuffer = device.createBuffer( {
			size: primCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		} );
		const valsBuffer = device.createBuffer( {
			size: primCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		} );

		// Generate test data: keys are the same morton codes from the build,
		// vals are 0, 1, 2, ..., primCount-1
		const testKeys = await this._readBuffer(
			this.gpuBVH._buildBuffers.mortonCodes,
			primCount * 4,
			Uint32Array
		);

		// Copy the original unsorted morton codes
		const origMortonCodes = new Uint32Array( testKeys );

		const testVals = new Uint32Array( primCount );
		for ( let i = 0; i < primCount; i ++ ) {

			testVals[ i ] = i;

		}

		// Upload test data
		device.queue.writeBuffer( keysBuffer, 0, testKeys );
		device.queue.writeBuffer( valsBuffer, 0, testVals );

		// Sort
		const commandEncoder = device.createCommandEncoder();
		sorter.sort( {
			commandEncoder,
			keysIn: keysBuffer,
			keysOut: keysBuffer, // In-place for OneSweep (after 4 passes)
			valsIn: valsBuffer,
			valsOut: valsBuffer,
			count: primCount,
		} );
		device.queue.submit( [ commandEncoder.finish() ] );
		await device.queue.onSubmittedWorkDone();

		// Read back results
		const sortedKeys = await this._readBuffer( keysBuffer, primCount * 4, Uint32Array );
		const sortedVals = await this._readBuffer( valsBuffer, primCount * 4, Uint32Array );

		// Verify keys are sorted
		for ( let i = 0; i < primCount - 1; i ++ ) {

			if ( sortedKeys[ i ] > sortedKeys[ i + 1 ] ) {

				stats.keysOutOfOrder ++;
				if ( stats.keysOutOfOrder <= 5 ) {

					errors.push(
						`Key out of order at ${i}: 0x${sortedKeys[ i ].toString( 16 )} > 0x${sortedKeys[ i + 1 ].toString( 16 )}`
					);

				}

			}

		}

		// Verify payload is a valid permutation (no duplicates, no missing)
		const seen = new Set();
		for ( let i = 0; i < primCount; i ++ ) {

			const val = sortedVals[ i ];
			if ( val >= primCount ) {

				stats.payloadMissing ++;
				if ( errors.length < 10 ) {

					errors.push( `Invalid payload at ${i}: ${val} >= ${primCount}` );

				}

			} else if ( seen.has( val ) ) {

				stats.payloadDuplicates ++;
				if ( stats.payloadDuplicates <= 5 ) {

					// Find where we first saw this value
					let firstIdx = - 1;
					for ( let j = 0; j < i; j ++ ) {

						if ( sortedVals[ j ] === val ) {

							firstIdx = j;
							break;

						}

					}

					errors.push(
						`Duplicate payload ${val} at indices ${firstIdx} and ${i} ` +
						`(keys: 0x${sortedKeys[ firstIdx ].toString( 16 )}, 0x${sortedKeys[ i ].toString( 16 )})`
					);

				}

			} else {

				seen.add( val );

			}

		}

		stats.payloadMissing = primCount - seen.size;
		if ( stats.payloadMissing > 0 && stats.payloadDuplicates === 0 ) {

			errors.push( `${stats.payloadMissing} payload values missing (no duplicates found)` );

		}

		// Verify key-payload correspondence: sortedKeys[i] should equal origMortonCodes[sortedVals[i]]
		let correspondenceErrors = 0;
		for ( let i = 0; i < primCount; i ++ ) {

			const payloadIdx = sortedVals[ i ];
			if ( payloadIdx < primCount && sortedKeys[ i ] !== origMortonCodes[ payloadIdx ] ) {

				correspondenceErrors ++;
				if ( correspondenceErrors <= 3 ) {

					errors.push(
						`Key-payload mismatch at ${i}: key=0x${sortedKeys[ i ].toString( 16 )}, ` +
						`expected origMortonCodes[${payloadIdx}]=0x${origMortonCodes[ payloadIdx ].toString( 16 )}`
					);

				}

			}

		}

		// Additional check: for out-of-order elements, see if they're "swapped"
		// (each got the other's expected position)
		if ( stats.keysOutOfOrder > 0 ) {

			// Build a map of key -> expected sorted position (using a simple CPU sort as reference)
			const keyValuePairs = [];
			for ( let i = 0; i < primCount; i ++ ) {

				keyValuePairs.push( { key: origMortonCodes[ i ], origIdx: i } );

			}

			keyValuePairs.sort( ( a, b ) => {

				if ( a.key !== b.key ) return a.key - b.key;
				return a.origIdx - b.origIdx; // Stable sort by original index

			} );

			// Now compare: where should each element be vs where it actually ended up?
			for ( let i = 0; i < Math.min( 10, primCount ); i ++ ) {

				const expectedOrigIdx = keyValuePairs[ i ].origIdx;
				const actualOrigIdx = sortedVals[ i ];

				if ( expectedOrigIdx !== actualOrigIdx ) {

					const expectedKey = origMortonCodes[ expectedOrigIdx ];
					const actualKey = sortedKeys[ i ];

					// Only report if this is near the error
					if ( ( i >= 2490 && i <= 2495 ) || ( i >= 2556 && i <= 2561 ) ) {

						stats[ `position_${i}_expected` ] = {
							origIdx: expectedOrigIdx,
							key: `0x${expectedKey.toString( 16 ).padStart( 8, '0' )}`,
						};
						stats[ `position_${i}_actual` ] = {
							origIdx: actualOrigIdx,
							key: `0x${actualKey.toString( 16 ).padStart( 8, '0' )}`,
						};

					}

				}

			}

			// Also check the specific error positions (2492, 2558)
			for ( const pos of [ 2492, 2493, 2558, 2559 ] ) {

				if ( pos < primCount ) {

					const expectedOrigIdx = keyValuePairs[ pos ].origIdx;
					const actualOrigIdx = sortedVals[ pos ];
					const expectedKey = origMortonCodes[ expectedOrigIdx ];
					const actualKey = sortedKeys[ pos ];

					stats[ `position_${pos}_expected` ] = {
						origIdx: expectedOrigIdx,
						key: `0x${expectedKey.toString( 16 ).padStart( 8, '0' )}`,
					};
					stats[ `position_${pos}_actual` ] = {
						origIdx: actualOrigIdx,
						key: `0x${actualKey.toString( 16 ).padStart( 8, '0' )}`,
					};

				}

			}

		}

		stats.correspondenceErrors = correspondenceErrors;

		// Additional analysis: for each out-of-order error, find where elements should have gone
		if ( stats.keysOutOfOrder > 0 ) {

			// Build reverse lookup: for each original index, where did it end up?
			const payloadToSortedIdx = new Map();
			for ( let i = 0; i < primCount; i ++ ) {

				payloadToSortedIdx.set( sortedVals[ i ], i );

			}

			// For the first few out-of-order pairs, analyze in detail
			let analysisCount = 0;
			for ( let i = 0; i < primCount - 1 && analysisCount < 3; i ++ ) {

				if ( sortedKeys[ i ] > sortedKeys[ i + 1 ] ) {

					analysisCount ++;
					const key_i = sortedKeys[ i ];
					const key_i1 = sortedKeys[ i + 1 ];
					const payload_i = sortedVals[ i ];
					const payload_i1 = sortedVals[ i + 1 ];

					// Where in the ORIGINAL array were these elements?
					const origKey_i = origMortonCodes[ payload_i ];
					const origKey_i1 = origMortonCodes[ payload_i1 ];

					// The element at i should have gone to a LATER position
					// The element at i+1 should have gone to an EARLIER position
					// Find what's missing between them
					const PART_SIZE = 256 * 15;
					const partId_i = Math.floor( payload_i / PART_SIZE );
					const partId_i1 = Math.floor( payload_i1 / PART_SIZE );
					const subgroupSize = 32;
					const elementsPerSubgroup = subgroupSize * 15;
					const subgroup_i = Math.floor( ( payload_i % PART_SIZE ) / elementsPerSubgroup );
					const subgroup_i1 = Math.floor( ( payload_i1 % PART_SIZE ) / elementsPerSubgroup );

					errors.push(
						`Analysis for error at ${i}: ` +
						`payload[${i}]=${payload_i} (orig partId=${partId_i}, subgroup=${subgroup_i}), ` +
						`payload[${i + 1}]=${payload_i1} (orig partId=${partId_i1}, subgroup=${subgroup_i1}), ` +
						`origKey correspondence: key[${i}]=0x${key_i.toString( 16 )} vs orig[${payload_i}]=0x${origKey_i.toString( 16 )}, ` +
						`key[${i + 1}]=0x${key_i1.toString( 16 )} vs orig[${payload_i1}]=0x${origKey_i1.toString( 16 )}`
					);

				}

			}

		}

		// Cleanup
		keysBuffer.destroy();
		valsBuffer.destroy();

		const valid = stats.keysOutOfOrder === 0 &&
			stats.payloadDuplicates === 0 &&
			stats.payloadMissing === 0 &&
			correspondenceErrors === 0;

		return { valid, errors, stats };

	}

	// ---- Private helpers ----

	async _readBuffer( gpuBuffer, size, TypedArrayClass ) {

		const device = this.device;

		const readBuffer = device.createBuffer( {
			size,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );

		const commandEncoder = device.createCommandEncoder();
		commandEncoder.copyBufferToBuffer( gpuBuffer, 0, readBuffer, 0, size );
		device.queue.submit( [ commandEncoder.finish() ] );

		await readBuffer.mapAsync( GPUMapMode.READ );
		const mappedRange = readBuffer.getMappedRange();

		let result;
		if ( TypedArrayClass === ArrayBuffer ) {

			// Return a copy of the ArrayBuffer
			result = mappedRange.slice( 0 );

		} else {

			// Return typed array copy
			result = new TypedArrayClass( new TypedArrayClass( mappedRange ) );

		}

		readBuffer.unmap();
		readBuffer.destroy();

		return result;

	}

	_parseBVH2Nodes( buffer, nodeCount ) {

		const nodes = [];
		const floatView = new Float32Array( buffer );
		const uintView = new Uint32Array( buffer );

		// WGSL struct layout for BVH2Node (32 bytes total):
		// struct BVH2Node {
		//     boundsMin: vec3f,  // offset 0, size 12
		//     leftChild: u32,    // offset 12, size 4
		//     boundsMax: vec3f,  // offset 16, size 12 (vec3f has alignment 16)
		//     rightChild: u32,   // offset 28, size 4
		// };

		for ( let i = 0; i < nodeCount; i ++ ) {

			const base = i * 8; // 32 bytes / 4 = 8 u32s per node

			nodes.push( {
				bounds: {
					minX: floatView[ base + 0 ], // offset 0
					minY: floatView[ base + 1 ], // offset 4
					minZ: floatView[ base + 2 ], // offset 8
					maxX: floatView[ base + 4 ], // offset 16
					maxY: floatView[ base + 5 ], // offset 20
					maxZ: floatView[ base + 6 ], // offset 24
				},
				leftChild: uintView[ base + 3 ], // offset 12
				rightChild: uintView[ base + 7 ], // offset 28
			} );

		}

		return nodes;

	}

	_boundsContain( parent, child, epsilon = 1e-5 ) {

		return (
			child.minX >= parent.minX - epsilon &&
			child.minY >= parent.minY - epsilon &&
			child.minZ >= parent.minZ - epsilon &&
			child.maxX <= parent.maxX + epsilon &&
			child.maxY <= parent.maxY + epsilon &&
			child.maxZ <= parent.maxZ + epsilon
		);

	}

	/**
	 * Debug method: Validate the sorter one pass at a time.
	 * This helps identify which radix pass causes corruption.
	 * @returns {Promise<{passResults: object[]}>}
	 */
	async validateSorterPerPass() {

		const primCount = this.gpuBVH._primCount;
		const device = this.device;
		const sorter = this.gpuBVH.sorter;

		if ( ! sorter || sorter.name !== 'OneSweep' ) {

			return { error: 'Per-pass validation only works with OneSweep sorter' };

		}

		// Read original morton codes
		const origKeys = await this._readBuffer(
			this.gpuBVH._buildBuffers.mortonCodes,
			primCount * 4,
			Uint32Array
		);

		const PART_SIZE = 3840;
		const threadBlocks = Math.ceil( primCount / PART_SIZE );

		console.log( `\n=== Per-Pass Debug Validation ===` );
		console.log( `primCount: ${primCount}, threadBlocks: ${threadBlocks}` );
		console.log( `Last partition size: ${primCount - ( threadBlocks - 1 ) * PART_SIZE}` );

		// Track specific elements we're interested in
		const watchIndices = [ 2492, 2493, 2557, 2558, 2559 ];
		const LANE_COUNT = 32; // Assumed
		const KEYS_PER_THREAD = 15;
		const ELEMENTS_PER_SUBGROUP = LANE_COUNT * KEYS_PER_THREAD; // 32 * 15 = 480

		console.log( `\nOriginal values at watch indices:` );
		for ( const idx of watchIndices ) {

			if ( idx < primCount ) {

				const partId = Math.floor( idx / PART_SIZE );
				const localIdx = idx % PART_SIZE;
				const subgroupId = Math.floor( localIdx / ELEMENTS_PER_SUBGROUP );
				const withinSubgroup = localIdx % ELEMENTS_PER_SUBGROUP;
				const lane = withinSubgroup % LANE_COUNT;
				const k = Math.floor( withinSubgroup / LANE_COUNT );

				console.log( `  origKeys[${idx}] = 0x${origKeys[ idx ].toString( 16 ).padStart( 8, '0' )} ` +
					`bytes=[${origKeys[ idx ] & 0xff}, ${( origKeys[ idx ] >> 8 ) & 0xff}, ` +
					`${( origKeys[ idx ] >> 16 ) & 0xff}, ${( origKeys[ idx ] >> 24 ) & 0xff}] ` +
					`(part=${partId}, subgroup=${subgroupId}, lane=${lane}, k=${k})` );

			}

		}

		// Check how many times the problematic key 0x359d00d7 appears in original data
		const problemKey = 0x359d00d7;
		let problemKeyCount = 0;
		const problemKeyPositions = [];
		for ( let i = 0; i < primCount; i ++ ) {

			if ( origKeys[ i ] === problemKey ) {

				problemKeyCount ++;
				if ( problemKeyPositions.length < 5 ) {

					problemKeyPositions.push( i );

				}

			}

		}

		console.log( `\nProblem key 0x${problemKey.toString( 16 )} appears ${problemKeyCount} times in original data` );
		if ( problemKeyPositions.length > 0 ) {

			console.log( `  First occurrences at indices: ${problemKeyPositions.join( ', ' )}` );

		}

		// Check if sorter has internal status buffer we can read
		if ( sorter._buffers && sorter._buffers.status ) {

			const statusData = await this._readBuffer( sorter._buffers.status, 16, Uint32Array );
			console.log( `\nSorter status buffer: [${statusData[ 0 ].toString( 16 )}, ${statusData[ 1 ].toString( 16 )}, ${statusData[ 2 ].toString( 16 )}, ${statusData[ 3 ].toString( 16 )}]` );
			if ( statusData[ 0 ] !== 0 ) console.log( `  STATUS_ERR_GLOBAL_HIST: 0x${statusData[ 0 ].toString( 16 )}` );
			if ( statusData[ 1 ] !== 0 ) console.log( `  STATUS_ERR_SCAN: 0x${statusData[ 1 ].toString( 16 )}` );
			if ( statusData[ 2 ] !== 0 ) console.log( `  STATUS_ERR_PASS: 0x${statusData[ 2 ].toString( 16 )}` );
			if ( statusData[ 3 ] !== 0 ) console.log( `  STATUS_ERR_LANE_COUNT: 0x${statusData[ 3 ].toString( 16 )}` );

		}

		// Verify global histogram by computing CPU reference
		console.log( `\nVerifying global histogram...` );
		const cpuHist = new Uint32Array( 256 * 4 ); // 4 passes x 256 digits
		for ( let i = 0; i < primCount; i ++ ) {

			const key = origKeys[ i ];
			cpuHist[ ( key & 0xff ) ] ++;
			cpuHist[ 256 + ( ( key >> 8 ) & 0xff ) ] ++;
			cpuHist[ 512 + ( ( key >> 16 ) & 0xff ) ] ++;
			cpuHist[ 768 + ( ( key >> 24 ) & 0xff ) ] ++;

		}

		// Read GPU histogram (it's populated after the sort, so we need to re-run global_hist)
		// For now, just compute expected totals
		let totalCpuHist = 0;
		for ( let i = 0; i < 256; i ++ ) totalCpuHist += cpuHist[ i ];
		console.log( `  CPU histogram pass 0 sum: ${totalCpuHist} (expected: ${primCount})` );

		// Check specific digits involved in the corruption
		const digits2493 = {
			d0: origKeys[ 2493 ] & 0xff,
			d1: ( origKeys[ 2493 ] >> 8 ) & 0xff,
			d2: ( origKeys[ 2493 ] >> 16 ) & 0xff,
			d3: ( origKeys[ 2493 ] >> 24 ) & 0xff,
		};
		const digits2558 = {
			d0: origKeys[ 2558 ] & 0xff,
			d1: ( origKeys[ 2558 ] >> 8 ) & 0xff,
			d2: ( origKeys[ 2558 ] >> 16 ) & 0xff,
			d3: ( origKeys[ 2558 ] >> 24 ) & 0xff,
		};
		console.log( `  origKeys[2493]=0x${origKeys[ 2493 ].toString( 16 )} digits: d0=${digits2493.d0}, d1=${digits2493.d1}, d2=${digits2493.d2}, d3=${digits2493.d3}` );
		console.log( `  origKeys[2558]=0x${origKeys[ 2558 ].toString( 16 )} digits: d0=${digits2558.d0}, d1=${digits2558.d1}, d2=${digits2558.d2}, d3=${digits2558.d3}` );
		console.log( `  CPU histogram counts for digit d0=${digits2493.d0}: ${cpuHist[ digits2493.d0 ]}` );
		console.log( `  CPU histogram counts for digit d0=${digits2558.d0}: ${cpuHist[ digits2558.d0 ]}` );

		// Create buffers
		const keysBuffer = device.createBuffer( {
			size: primCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		} );
		const valsBuffer = device.createBuffer( {
			size: primCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		} );
		const altKeysBuffer = device.createBuffer( {
			size: primCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		} );
		const altValsBuffer = device.createBuffer( {
			size: primCount * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		} );

		// Initialize values as 0, 1, 2, ...
		const initVals = new Uint32Array( primCount );
		for ( let i = 0; i < primCount; i ++ ) initVals[ i ] = i;

		device.queue.writeBuffer( keysBuffer, 0, origKeys );
		device.queue.writeBuffer( valsBuffer, 0, initVals );

		const passResults = [];

		// OneSweep performs all 4 radix passes internally, so this validation path
		// executes one full sort and inspects the final output.
		const commandEncoder = device.createCommandEncoder();

		sorter.sort( {
			commandEncoder,
			keysIn: keysBuffer,
			keysOut: keysBuffer,
			valsIn: valsBuffer,
			valsOut: valsBuffer,
			count: primCount,
		} );

		device.queue.submit( [ commandEncoder.finish() ] );
		await device.queue.onSubmittedWorkDone();

		// Read final result
		const sortedKeys = await this._readBuffer( keysBuffer, primCount * 4, Uint32Array );
		const sortedVals = await this._readBuffer( valsBuffer, primCount * 4, Uint32Array );

		// Find where watch elements ended up
		console.log( `\nFinal positions of watch elements:` );
		for ( const origIdx of watchIndices ) {

			let foundAt = - 1;
			let count = 0;
			for ( let i = 0; i < primCount; i ++ ) {

				if ( sortedVals[ i ] === origIdx ) {

					if ( foundAt === - 1 ) foundAt = i;
					count ++;

				}

			}

			if ( foundAt >= 0 ) {

				console.log( `  origIdx ${origIdx} (key 0x${origKeys[ origIdx ].toString( 16 ).padStart( 8, '0' )}) ` +
					`-> position ${foundAt}${count > 1 ? ` (DUPLICATED ${count}x!)` : ''}` );

			} else {

				console.log( `  origIdx ${origIdx} (key 0x${origKeys[ origIdx ].toString( 16 ).padStart( 8, '0' )}) ` +
					`-> MISSING!` );

			}

		}

		// Check what's at the error positions
		console.log( `\nValues at error positions:` );
		for ( const pos of [ 2492, 2557, 629828 ] ) {

			if ( pos < primCount ) {

				const key = sortedKeys[ pos ];
				const val = sortedVals[ pos ];
				console.log( `  position ${pos}: key=0x${key.toString( 16 ).padStart( 8, '0' )}, payload=${val} ` +
					`(orig key was 0x${origKeys[ val ].toString( 16 ).padStart( 8, '0' )})` );

			}

		}

		// Count duplicates and missing
		const seen = new Map();
		let duplicates = 0;
		for ( let i = 0; i < primCount; i ++ ) {

			const val = sortedVals[ i ];
			if ( seen.has( val ) ) {

				duplicates ++;
				if ( duplicates <= 3 ) {

					console.log( `  DUPLICATE: payload ${val} at positions ${seen.get( val )} and ${i}` );

				}

			} else {

				seen.set( val, i );

			}

		}

		passResults.push( {
			pass: 'all',
			keysOutOfOrder: this._countOutOfOrder( sortedKeys ),
			duplicates,
			missing: primCount - seen.size,
		} );

		// Cleanup
		keysBuffer.destroy();
		valsBuffer.destroy();
		altKeysBuffer.destroy();
		altValsBuffer.destroy();

		return { passResults };

	}

	_countOutOfOrder( arr ) {

		let count = 0;
		for ( let i = 0; i < arr.length - 1; i ++ ) {

			if ( arr[ i ] > arr[ i + 1 ] ) count ++;

		}

		return count;

	}

}
