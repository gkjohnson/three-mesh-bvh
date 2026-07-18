import { Node, TSL } from 'three/webgpu';

class ProxyCallNode extends Node {

	static get type() {

		return 'ProxyCallNode';

	}

	constructor( proxyNode, params ) {

		super();
		this.proxyNode = proxyNode;
		this.params = params;

	}

	setup() {

		return this.proxyNode.proxyNode.call( ...this.params );

	}

}

export class NodeProxy {

	get isNode() {

		return true;

	}

	// getter for the node being proxied to
	get proxyNode() {

		const { proxyObject, proxyProperty } = this;
		const properties = proxyProperty.split( '.' );
		let value = proxyObject;
		for ( let i = 0, l = properties.length; i < l; i ++ ) {

			value = value?.[ properties[ i ] ];

		}

		if ( value && 'functionNode' in value ) {

			return value.functionNode;

		} else {

			return value ?? null;

		}

	}

	constructor( property, object = null ) {

		// store the proxy property and objects so they can be changed later
		this.proxyObject = object;
		this.proxyProperty = property;

		// set up a proxy to redirect all calls to the proxied node in order to avoid replicating
		// expected members for all node types.
		return new Proxy( this, {

			get( target, property ) {

				if ( property in target ) {

					return Reflect.get( target, property );

				} else {

					const node = target.proxyNode;
					if ( ! node ) {

						return undefined;

					}

					const value = Reflect.get( node, property );
					if ( typeof value === 'function' ) {

						return value.bind( node );

					} else {

						return value;

					}

				}

			},

			set( target, property, value ) {

				if ( property in target ) {

					return Reflect.set( target, property, value );

				} else {

					throw new Error( 'NodeProxy: Cannot set members of proxied nodes.' );

				}

			},

		} );

	}

}

export const proxy = ( ...args ) => {

	return new NodeProxy( ...args );

};

export const proxyFn = ( ...args ) => {

	const nodeProxy = new NodeProxy( ...args );
	const fn = ( ...params ) => new ProxyCallNode( nodeProxy, params );
	return TSL.nodeProxyConstructor( fn, nodeProxy );

};

//

// A node proxy that falls back to the active context
export class ContextNodeProxy extends NodeProxy {

	get proxyNode() {

		return super.proxyNode || this.fallbackNode;

	}

	constructor( path, def ) {

		super( path, null );

		Object.defineProperty( this, 'fallbackNode', {
			value: def,
		} );

	}

	setup( builder ) {

		this.proxyObject = builder.getContext();
		return this.proxyNode.setup( builder );

	}

}

export const contextProxy = ( ...args ) => {

	return new ContextNodeProxy( ...args );

};

export const contextProxyFn = ( ...args ) => {

	const nodeProxy = new ContextNodeProxy( ...args );
	const fn = ( ...params ) => new ProxyCallNode( nodeProxy, params );
	return TSL.nodeProxyConstructor( fn, nodeProxy );

};
