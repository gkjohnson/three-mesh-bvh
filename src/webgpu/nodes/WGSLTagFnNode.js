import { CodeNode, FunctionNode, Node } from 'three/webgpu';

// minimal node that outputs a raw WGSL expression verbatim when built
class LiteralExpression extends Node {

	constructor( literal ) {

		super();
		this.literal = literal;

	}

	build() {

		return this.literal;

	}

}

// wraps a FunctionNode so that build() returns just the function name
class PropertyRefNode extends Node {

	constructor( node, output = 'property' ) {

		super();
		this.node = node;
		this.output = output;

	}

	build( builder ) {

		return this.node.build( builder, this.output );

	}

}

// wraps a FunctionCallNode so that build() returns the inline call expression,
// bypassing TempNode's variable wrapping
class InlineCallNode extends Node {

	constructor( node ) {

		super();
		this.node = node;

	}

	build( builder ) {

		return this.node.generate( builder );

	}

}

// returns the node that should be registered as an include for the given arg
function getIncludeNode( arg ) {

	if ( typeof arg === 'function' ) {

		if ( arg.functionNode ) return arg.functionNode;
		if ( arg.isStruct ) return arg.layout;
		else return null;

	} else if ( arg.isNode ) {

		return new PropertyRefNode( arg );

	} else {

		return null;

	}

}

// extract dependency nodes from template args for include registration
function extractIncludes( args ) {

	const includes = [];
	for ( const arg of args ) {

		if ( Array.isArray( arg ) ) {

			for ( const element of arg ) {

				const node = getIncludeNode( element );
				if ( node ) includes.push( node );

			}

		} else {

			// WGSLTagCodeNodes should be inlined if found in a template so skip it here
			if ( ! ( arg instanceof WGSLTagCodeNode ) ) {

				const node = getIncludeNode( arg );
				if ( node ) includes.push( node );

			}

		}

	}

	return includes;

}

// normalize args so generate can resolve them uniformly with build():
// - callable wrappers > PropertyRefNode (emits just the function name)
// - struct callables > StructTypeNode (emits the type name via build)
// - FunctionCallNodes > InlineCallNode (emits inline call)
function normalizeArgs( args ) {

	return args.map( arg => {

		if ( typeof arg === 'function' && arg.functionNode ) return new PropertyRefNode( arg.functionNode );
		if ( typeof arg === 'function' && arg.isStruct ) return arg.layout;
		if ( arg && arg.isNode && arg.functionNode ) return new InlineCallNode( arg );
		if ( arg && arg.isNode ) {

			if ( arg instanceof WGSLTagCodeNode ) {

				// use a custom flag for this node to inline the output
				return new PropertyRefNode( arg, 'inline' );

			} else {

				return new PropertyRefNode( arg );

			}

		}

		return arg;

	} );

}

// interleave static tokens with resolved arg values
function assembleTemplate( tokens, args, builder ) {

	let code = '';
	for ( let i = 0, l = tokens.length; i < l; i ++ ) {

		code += tokens[ i ];
		if ( i < args.length ) {

			const arg = args[ i ];
			if ( Array.isArray( arg ) ) {

				// include array — no text output

			} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

				code += String( arg );

			} else {

				code += arg.build( builder );

			}

		}

	}

	return code;

}

export class WGSLTagFnNode extends FunctionNode {

	static get type() {

		return 'WGSLTagFnNode';

	}

	constructor( tokens, args, lang = 'wgsl' ) {

		super( '', extractIncludes( args ), lang );

		this.tokens = tokens;
		this.args = args;

	}

	// assemble the signature from tokens and arg names then parse
	getNodeFunction( builder ) {

		const { tokens } = this;
		const args = normalizeArgs( this.args );

		const nodeData = builder.getDataFromNode( this );
		let nodeFunction = nodeData.nodeFunction;
		if ( nodeFunction === undefined ) {

			// reconstruct the full code with known names for struct args
			// and dummy identifiers for everything else
			let fullCode = '';
			for ( let i = 0, l = tokens.length; i < l; i ++ ) {

				fullCode += tokens[ i ];

				if ( i < args.length ) {

					const arg = args[ i ];
					if ( Array.isArray( arg ) ) {

						// include array — no text output

					} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

						// literals
						fullCode += String( arg );

					} else if ( arg.isStructLayoutNode ) {

						// struct type node
						fullCode += arg.getNodeType( builder );

					} else if ( arg.isStruct ) {

						// struct
						fullCode += arg.layout.getNodeType( builder );

					} else {

						fullCode += '_arg' + i;

					}

				}

			}

			// remove comments
			fullCode = fullCode.replace( /\/\/.+[\n\r]/g, '' );

			// parse it so we have the signature defined - we will define the body content after
			nodeFunction = builder.parser.parseFunction( fullCode );
			nodeData.nodeFunction = nodeFunction;

		}

		return nodeFunction;

	}

	// get the code for the function
	generate( builder, output ) {

		const result = super.generate( builder, output );
		const fullCode = assembleTemplate( this.tokens, normalizeArgs( this.args ), builder );

		const { type } = this.getNodeFunction( builder );
		const nodeCode = builder.getCodeFromNode( this, type );

		nodeCode.code = fullCode.replace( /\/\/.+[\n\r]/g, '' ).replace( /->\s*void/, '' ).trim();
		return result;

	}

}

export class WGSLTagCodeNode extends CodeNode {

	static get type() {

		return 'WGSLTagCodeNode';

	}

	constructor( tokens, args, lang = 'wgsl' ) {

		super( '', extractIncludes( args ), lang );

		this.tokens = tokens;
		this.args = args;

	}

	build( builder, output ) {

		if ( output === 'inline' ) {

			return assembleTemplate( this.tokens, normalizeArgs( this.args ), builder );

		} else {

			return super.build( builder, output );

		}

	}

	generate( builder ) {

		super.generate( builder );

		const nodeCode = builder.getCodeFromNode( this, this.getNodeType( builder ) );
		nodeCode.code = assembleTemplate( this.tokens, normalizeArgs( this.args ), builder );
		return nodeCode.code;

	}

}

const getFn = functionNode => {

	const fn = ( ...params ) => {

		// wrap string parameter values as raw WGSL expressions so they
		// output verbatim as identifiers like local variable names
		if ( params.length === 1 && params[ 0 ] && typeof params[ 0 ] === 'object' && ! params[ 0 ].isNode ) {

			const obj = params[ 0 ];
			for ( const key in obj ) {

				if ( typeof obj[ key ] === 'string' ) {

					obj[ key ] = new LiteralExpression( obj[ key ] );

				}

			}

		}

		return functionNode.call( ...params );

	};

	fn.functionNode = functionNode;
	return fn;

};

// template tag literal function version of "wgslFn" & "wgsl" to generate
// functions & code snippets respectively
export const wgslTagFn = ( tokens, ...args ) => getFn( new WGSLTagFnNode( tokens, args ) );
export const wgslTagCode = ( tokens, ...args ) => new WGSLTagCodeNode( tokens, args );

// glsl versions
export const glslTagFn = ( tokens, ...args ) => getFn( new WGSLTagFnNode( tokens, args, 'glsl' ) );
export const glslTagCode = ( tokens, ...args ) => new WGSLTagCodeNode( tokens, args, 'glsl' );
