import { COUNT, IS_LEAF, LEFT_NODE, OFFSET, RIGHT_NODE, SPLIT_AXIS } from './utils/nodeBufferUtils.js';

export const BVHTraversalHelper = new ( class {

	constructor() {

		let buffer = null;
		let uint32Array = null;
		let uint16Array = null;
		let traversing = false;

		this.root = null;
		this.buffer = null;
		this.uint32Array = null;
		this.uint16Array = null;

		this.setBVH = ( bvh, root ) => {

			if ( traversing ) {

				throw new Error( 'BVHTraversalHelper: cannot call setBVH during an active traversal.' );

			}

			this.root = root;
			this.buffer = buffer = bvh._roots[ root ];
			this.uint16Array = uint16Array = new Uint16Array( buffer );
			this.uint32Array = uint32Array = new Uint32Array( buffer );

		};

		this.reset = () => {

			this.root = null;
			this.buffer = buffer = null;
			this.uint16Array = uint16Array = null;
			this.uint32Array = uint32Array = null;

		};

		this.getRangeStart = node32Index => {

			let node16Index = node32Index * 2;
			while ( ! IS_LEAF( node16Index, uint16Array ) ) {

				node32Index = LEFT_NODE( node32Index );
				node16Index = node32Index * 2;

			}

			return OFFSET( node32Index, uint32Array );

		};

		this.getRangeEnd = node32Index => {

			let node16Index = node32Index * 2;
			while ( ! IS_LEAF( node16Index, uint16Array ) ) {

				node32Index = RIGHT_NODE( node32Index, uint32Array );
				node16Index = node32Index * 2;

			}

			return OFFSET( node32Index, uint32Array ) + COUNT( node16Index, uint16Array );

		};

		// internal recursive walk - the public "traverseBuffer" wraps this with the re-entrancy guard
		const walk = ( callback, node32Index, depth ) => {

			const node16Index = node32Index * 2;
			const isLeaf = IS_LEAF( node16Index, uint16Array );
			const stopTraversal = callback( depth, isLeaf, node32Index );
			if ( ! stopTraversal && ! isLeaf ) {

				const left = LEFT_NODE( node32Index );
				const right = RIGHT_NODE( node32Index, uint32Array );
				walk( callback, left, depth + 1 );
				walk( callback, right, depth + 1 );

			}

		};

		this.traverseBuffer = callback => {

			if ( traversing ) {

				throw new Error( 'BVHTraversalHelper: cannot start a traversal during an active traversal.' );

			}

			traversing = true;
			try {

				walk( callback, 0, 0 );

			} finally {

				traversing = false;

			}

		};

		this.traverse = callback => {

			this.traverseBuffer( ( depth, isLeaf, node32Index ) => {

				if ( isLeaf ) {

					const node16Index = node32Index * 2;
					const offset = uint32Array[ node32Index + 6 ];
					const count = uint16Array[ node16Index + 14 ];
					return callback( depth, isLeaf, new Float32Array( buffer, node32Index * 4, 6 ), offset, count );

				} else {

					const splitAxis = SPLIT_AXIS( node32Index, uint32Array );
					return callback( depth, isLeaf, new Float32Array( buffer, node32Index * 4, 6 ), splitAxis );

				}

			} );

		};

	}

} )();
