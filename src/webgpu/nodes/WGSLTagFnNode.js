import { CodeNode, FunctionNode, Node, TSL } from 'three/webgpu';

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

// returns the node that should be registered as an include for the given arg
function getIncludeNode( arg ) {

	if ( arg.isNode ) return new PropertyRefNode( arg );
	return null;

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

		}

	}

	return includes;

}

// normalize args so generate can resolve them uniformly with build():
// - callable wrappers > PropertyRefNode (emits just the function name)
function normalizeArgs( args, builder ) {

	return args.map( arg => {

		if ( arg && ! arg.isNode && arg instanceof Function ) {

			arg = arg( builder );

		}

		if ( arg && arg.isNode ) {

			arg.setup( builder );

			// TODO: this need to be made to work fluidly with the proxy node w/ context
			// instanceof is not safe for the proxy case
			if ( arg.isWGSLTagCodeNode ) {

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

		this.isWGSLTagFnNode = true;
		this.tokens = tokens;
		this.args = args;

	}

	setup( builder ) {

		super.setup( builder );
		this._normalizedArgs = normalizeArgs( this.args, builder );

	}

	// assemble the signature from tokens and arg names then parse
	getNodeFunction( builder ) {

		const { tokens, _normalizedArgs } = this;
		const nodeData = builder.getDataFromNode( this );
		let nodeFunction = nodeData.nodeFunction;
		if ( nodeFunction === undefined ) {

			// reconstruct the full code with known names for struct args
			// and dummy identifiers for everything else
			let fullCode = '';
			for ( let i = 0, l = tokens.length; i < l; i ++ ) {

				fullCode += tokens[ i ];

				if ( i < _normalizedArgs.length ) {

					const arg = _normalizedArgs[ i ];
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
		const { _normalizedArgs } = this;
		const fullCode = assembleTemplate( this.tokens, _normalizedArgs, builder );

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

		this.isWGSLTagCodeNode = true;
		this.tokens = tokens;
		this.args = args;

	}

	setup( builder ) {

		super.setup( builder );
		this._normalizedArgs = normalizeArgs( this.args, builder );

	}

	build( builder, output ) {

		if ( output === 'inline' ) {

			return assembleTemplate( this.tokens, this._normalizedArgs, builder );

		} else {

			return super.build( builder, output );

		}

	}

	generate( builder ) {

		super.generate( builder );

		const nodeCode = builder.getCodeFromNode( this, this.getNodeType( builder ) );
		nodeCode.code = assembleTemplate( this.tokens, this._normalizedArgs, builder );
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

	return TSL.nodeProxyConstructor( fn, functionNode );

};

// template tag literal function version of "wgslFn" & "wgsl" to generate
// functions & code snippets respectively
export const wgslTagFn = ( tokens, ...args ) => getFn( new WGSLTagFnNode( tokens, args ) );
export const wgslTagCode = ( tokens, ...args ) => new WGSLTagCodeNode( tokens, args );

// glsl versions
export const glslTagFn = ( tokens, ...args ) => getFn( new WGSLTagFnNode( tokens, args, 'glsl' ) );
export const glslTagCode = ( tokens, ...args ) => new WGSLTagCodeNode( tokens, args, 'glsl' );
