// Converts {@link url text} inline tags in a string to Markdown [text](url) links.
export function resolveLinks( str ) {

	if ( ! str ) return str;
	return str.replace( /\{@link\s+(\S+?)(?:\s+([^}]*?))?\}/g, ( _, url, text ) => {

		return text ? `[${ text }](${ url })` : `[${ url }](${ url })`;

	} );

}

// Renders any @warn / @note custom tags from a doclet as GFM alert blocks.
function renderAlertTags( doc ) {

	const lines = [];
	for ( const tag of ( doc.tags || [] ) ) {

		if ( tag.title === 'warn' || tag.title === 'note' ) {

			const type = tag.title === 'warn' ? 'WARNING' : 'NOTE';
			lines.push( `> [!${ type }]` );
			for ( const line of tag.value.split( '\n' ) ) {

				lines.push( `> ${ line }` );

			}

			lines.push( '' );

		}

	}

	return lines.join( '\n' );

}

// Converts a heading name to its GitHub Markdown anchor id.
export function toAnchor( name ) {

	return name.toLowerCase().replace( /[^a-z0-9]+/g, '' );

}

// Formats a callback typedef into an inline arrow-function type string.
// e.g. "( a: any, b: any ) => number"
function formatCallbackType( callbackDoc, callbackMap ) {

	const params = ( callbackDoc.params || [] ).map( p => {

		const type = formatType( p.type, callbackMap );
		return `${ p.name }: ${ type }`;

	} );

	const ret = ( callbackDoc.returns && callbackDoc.returns[ 0 ] )
		? formatType( callbackDoc.returns[ 0 ].type, callbackMap )
		: 'void';

	const sig = params.length > 0 ? ` ${ params.join( ', ' ) } ` : '';
	return `(${ sig }) => ${ ret }`;

}

// Formats a JSDoc type object into a type string, e.g. "string | Object | null".
// Strips JSDoc's dot-generic syntax: Promise.<void> -> Promise<void>
// Substitutes @callback typedef names with their inline arrow-function signature.
export function formatType( typeObj, callbackMap = {} ) {

	if ( ! typeObj || ! typeObj.names || typeObj.names.length === 0 ) return '';
	return typeObj.names
		.map( t => {

			if ( callbackMap[ t ] ) return formatCallbackType( callbackMap[ t ], callbackMap );
			return t.replace( /\.</g, '<' );

		} )
		.join( ' | ' );

}

// Formats a single param into the inline signature style: "name = default: Type"
export function formatParam( param, callbackMap = {} ) {

	const type = formatType( param.type, callbackMap );

	if ( param.defaultvalue !== undefined ) {

		return `${ param.name } = ${ param.defaultvalue }: ${ type }`;

	}

	return `${ param.name }: ${ type }`;

}

// Renders a parameter list into an array of lines. Expands any top-level params that have
// dotted sub-params as inline destructured objects, with callback types expanded multi-line.
function renderParamLines( allParams, callbackMap ) {

	const topLevel = allParams.filter( p => ! p.name.includes( '.' ) );

	const nestedMap = {};
	for ( const p of allParams ) {

		if ( p.name.includes( '.' ) ) {

			const topName = p.name.split( '.' )[ 0 ];
			if ( ! nestedMap[ topName ] ) nestedMap[ topName ] = [];
			nestedMap[ topName ].push( p );

		}

	}

	const hasAnyNested = topLevel.some( p => nestedMap[ p.name ] );
	if ( ! hasAnyNested ) return null; // caller should use simple inline form

	const lines = [];
	topLevel.forEach( ( p, i ) => {

		const nested = nestedMap[ p.name ];
		const comma = i < topLevel.length - 1 ? ',' : '';

		if ( nested ) {

			lines.push( '\t{' );
			for ( const opt of nested ) {

				const name = opt.name.split( '.' ).pop();
				const defStr = opt.defaultvalue !== undefined ? ` = ${ opt.defaultvalue }` : '';
				const optional = opt.optional && opt.defaultvalue === undefined ? '?' : '';
				const typeName = opt.type && opt.type.names && opt.type.names[ 0 ];
				const callbackDoc = typeName && callbackMap[ typeName ];

				if ( callbackDoc ) {

					const cbParams = callbackDoc.params || [];
					const cbRet = ( callbackDoc.returns && callbackDoc.returns[ 0 ] )
						? formatType( callbackDoc.returns[ 0 ].type, callbackMap )
						: 'void';

					lines.push( `\t\t${ name }${ defStr }${ optional }: (` );
					cbParams.forEach( ( cp, ci ) => {

						const cpType = formatType( cp.type, callbackMap );
						const cpComma = ci < cbParams.length - 1 ? ',' : '';
						lines.push( `\t\t\t${ cp.name }: ${ cpType }${ cpComma }` );

					} );
					lines.push( `\t\t) => ${ cbRet },` );

				} else {

					const type = formatType( opt.type, callbackMap );
					lines.push( `\t\t${ name }${ defStr }${ optional }: ${ type },` );

				}

			}

			lines.push( `\t}${ comma }` );

		} else {

			lines.push( `\t${ formatParam( p, callbackMap ) }${ comma }` );

		}

	} );

	return lines;

}

export function renderConstructor( classDoc, callbackMap = {} ) {

	const lines = [];

	lines.push( '### .constructor' );
	lines.push( '' );
	lines.push( '```js' );

	const paramLines = renderParamLines( classDoc.params || [], callbackMap );
	if ( paramLines ) {

		lines.push( 'constructor(' );
		lines.push( ...paramLines );
		lines.push( ')' );

	} else {

		const sig = ( classDoc.params || [] )
			.filter( p => ! p.name.includes( '.' ) )
			.map( p => formatParam( p, callbackMap ) )
			.join( ', ' );
		lines.push( `constructor( ${ sig } )` );

	}

	lines.push( '```' );
	lines.push( '' );

	// Constructor description (JSDoc puts it in `description`, not `classdesc`)
	if ( classDoc.description ) {

		lines.push( classDoc.description );
		lines.push( '' );

	}

	return lines.join( '\n' );

}

export function renderMember( doc, callbackMap = {} ) {

	const lines = [];

	lines.push( `### .${ doc.name }` );
	lines.push( '' );
	lines.push( '```js' );

	const type = formatType( doc.type, callbackMap );
	const readonly = doc.readonly ? 'readonly ' : '';
	lines.push( `${ readonly }${ doc.name }: ${ type }` );

	lines.push( '```' );
	lines.push( '' );

	if ( doc.description ) {

		lines.push( doc.description );
		lines.push( '' );

	}

	lines.push( renderAlertTags( doc ) );

	return lines.join( '\n' );

}

function renderCallable( doc, heading, sigPrefix, callbackMap ) {

	const lines = [];

	lines.push( heading );
	lines.push( '' );
	lines.push( '```js' );

	const allParams = doc.params || [];
	const topLevel = allParams.filter( p => ! p.name.includes( '.' ) );

	const ret = ( doc.returns && doc.returns[ 0 ] )
		? formatType( doc.returns[ 0 ].type, callbackMap )
		: 'void';

	const paramLines = renderParamLines( allParams, callbackMap );
	if ( paramLines ) {

		lines.push( `${ sigPrefix }${ doc.name }(` );
		lines.push( ...paramLines );
		lines.push( `): ${ ret }` );

	} else {

		const params = topLevel.map( p => formatParam( p, callbackMap ) );
		const singleLine = params.length
			? `${ sigPrefix }${ doc.name }( ${ params.join( ', ' ) } ): ${ ret }`
			: `${ sigPrefix }${ doc.name }(): ${ ret }`;

		if ( singleLine.length > 80 ) {

			lines.push( `${ sigPrefix }${ doc.name }(` );
			params.forEach( ( p, i ) => {

				const comma = i < params.length - 1 ? ',' : '';
				lines.push( `\t${ p }${ comma }` );

			} );
			lines.push( `): ${ ret }` );

		} else {

			lines.push( singleLine );

		}

	}

	lines.push( '```' );
	lines.push( '' );

	if ( doc.description ) {

		lines.push( doc.description );
		lines.push( '' );

	}

	lines.push( renderAlertTags( doc ) );

	return lines.join( '\n' );

}

export function renderMethod( doc, callbackMap = {} ) {

	const isStatic = doc.scope === 'static';
	const prefix = isStatic ? 'static ' : '';
	return renderCallable( doc, `### ${ prefix }.${ doc.name }`, prefix, callbackMap );

}

export function renderFunction( doc, callbackMap = {} ) {

	return renderCallable( doc, `### ${ doc.name }`, '', callbackMap );

}

export function renderFunctions( funcs, title = 'Functions', callbackMap = {}, typedefs = [], typedefCallbackMap = {}, resolveLink = null ) {

	if ( funcs.length === 0 && typedefs.length === 0 ) return '';

	const lines = [];

	lines.push( `## ${ title }` );
	lines.push( '' );

	for ( const td of typedefs ) {

		lines.push( renderTypedef( td, typedefCallbackMap, resolveLink, 3 ) );

	}

	for ( const fn of funcs ) {

		lines.push( renderFunction( fn, callbackMap ) );

	}

	return lines.join( '\n' );

}

export function renderConstants( constants, title = 'Constants', callbackMap = {} ) {

	if ( constants.length === 0 ) return '';

	const lines = [];

	lines.push( `## ${ title }` );
	lines.push( '' );

	for ( const c of constants ) {

		const type = formatType( c.type, callbackMap ) || 'number';
		lines.push( `### ${ c.name }` );
		lines.push( '' );
		lines.push( '```js' );
		lines.push( `${ c.name }: ${ type }` );
		lines.push( '```' );
		lines.push( '' );

		if ( c.description ) {

			lines.push( c.description );
			lines.push( '' );

		}

	}

	return lines.join( '\n' );

}

export function renderTypedef( typeDoc, callbackMap = {}, resolveLink = null, headingLevel = 2 ) {

	const h = '#'.repeat( headingLevel );
	const hSub = '#'.repeat( headingLevel + 1 );
	const lines = [];

	lines.push( `${ h } ${ typeDoc.name }` );
	lines.push( '' );

	// If the typedef's base type is not plain Object, treat it as an extension
	const baseType = typeDoc.type.names[ 0 ];
	if ( baseType && baseType !== 'Object' ) {

		const link = resolveLink && resolveLink( baseType );
		const ref = link ? `[\`${ baseType }\`](${ link })` : `\`${ baseType }\``;
		lines.push( `_extends ${ ref }_` );
		lines.push( '' );

	}

	if ( typeDoc.description ) {

		lines.push( typeDoc.description );
		lines.push( '' );

	}

	lines.push( renderAlertTags( typeDoc ) );

	for ( const prop of ( typeDoc.properties || [] ) ) {

		const type = formatType( prop.type, callbackMap );
		const optional = prop.optional ? '?' : '';
		lines.push( `${ hSub } .${ prop.name }` );
		lines.push( '' );
		lines.push( '```js' );
		lines.push( `${ prop.name }${ optional }: ${ type }` );
		lines.push( '```' );
		lines.push( '' );

		if ( prop.description ) {

			lines.push( prop.description );
			lines.push( '' );

		}

	}

	return lines.join( '\n' );

}

export function renderEvents( events, callbackMap = {} ) {

	const lines = [];

	lines.push( '### events' );
	lines.push( '' );
	lines.push( '```js' );

	for ( let i = 0; i < events.length; i ++ ) {

		const event = events[ i ];

		if ( event.description ) {

			for ( const descLine of event.description.split( '\n' ) ) {

				lines.push( `// ${ descLine }` );

			}

		}

		const props = event.properties || [];
		const propStr = props.map( p => {

			const type = formatType( p.type, callbackMap );
			const optional = p.optional ? '?' : '';
			return `${ p.name }${ optional }: ${ type }`;

		} ).join( ', ' );

		if ( propStr ) {

			lines.push( `{ type: '${ event.name }', ${ propStr } }` );

		} else {

			lines.push( `{ type: '${ event.name }' }` );

		}

		if ( i < events.length - 1 ) lines.push( '' );

	}

	lines.push( '```' );
	lines.push( '' );

	return lines.join( '\n' );

}

export function renderComponent( doc, callbackMap = {} ) {

	const lines = [];

	lines.push( `## ${ doc.name }` );
	lines.push( '' );

	if ( doc.description ) {

		lines.push( doc.description );
		lines.push( '' );

	}

	const props = ( doc.params || [] ).filter( p => p.name.includes( '.' ) );

	if ( props.length > 0 ) {

		lines.push( '### Props' );
		lines.push( '' );
		lines.push( '```jsx' );
		lines.push( `<${ doc.name }` );

		for ( const prop of props ) {

			const name = prop.name.split( '.' ).pop();
			const type = formatType( prop.type, callbackMap );
			const optional = prop.optional ? '?' : '';
			const defStr = prop.defaultvalue !== undefined ? ` = ${ prop.defaultvalue }` : '';
			lines.push( `\t${ name }${ optional }: ${ type }${ defStr }` );

		}

		lines.push( '/>' );
		lines.push( '```' );
		lines.push( '' );

		for ( const prop of props ) {

			const name = prop.name.split( '.' ).pop();
			const type = formatType( prop.type, callbackMap );
			const optional = prop.optional ? '?' : '';
			const defStr = prop.defaultvalue !== undefined ? ` = ${ prop.defaultvalue }` : '';
			lines.push( `### .${ name }` );
			lines.push( '' );
			lines.push( '```jsx' );
			lines.push( `${ name }${ optional }: ${ type }${ defStr }` );
			lines.push( '```' );
			lines.push( '' );

			if ( prop.description ) {

				lines.push( prop.description );
				lines.push( '' );

			}

		}

	}

	return lines.join( '\n' );

}

export function renderClass( classDoc, members, callbackMap = {}, resolveLink = null ) {

	const lines = [];

	lines.push( `## ${ classDoc.name }` );
	lines.push( '' );

	if ( classDoc.augments && classDoc.augments.length > 0 ) {

		const base = classDoc.augments[ 0 ];
		const link = resolveLink && resolveLink( base );
		const ref = link ? `[\`${ base }\`](${ link })` : `\`${ base }\``;
		lines.push( `_extends ${ ref }_` );
		lines.push( '' );

	}

	const classDesc = classDoc.classdesc || classDoc.description;
	if ( classDesc ) {

		lines.push( classDesc );
		lines.push( '' );

	}

	lines.push( renderAlertTags( classDoc ) );

	const visible = members.filter( m => m.access !== 'private' );
	// Treat function doclets that carry an explicit @type tag as properties
	// (e.g. arrow-function assignments like `this.schedulingCallback = func => ...`)
	const isProperty = m => m.kind === 'member' || ( m.kind === 'function' && m.type );
	const properties = visible
		.filter( isProperty )
		.sort( ( a, b ) => a.meta.lineno - b.meta.lineno );
	const allMethods = visible
		.filter( m => m.kind === 'function' && ! m.type )
		.sort( ( a, b ) => a.meta.lineno - b.meta.lineno );
	const staticMethods = allMethods.filter( m => m.scope === 'static' );
	const instanceMethods = allMethods.filter( m => m.scope !== 'static' );
	const events = visible
		.filter( m => m.kind === 'event' )
		.sort( ( a, b ) => a.meta.lineno - b.meta.lineno );

	if ( events.length > 0 ) {

		lines.push( renderEvents( events, callbackMap ) );

	}

	// Static methods appear first
	for ( const method of staticMethods ) {

		lines.push( renderMethod( method, callbackMap ) );

	}

	for ( const member of properties ) {

		lines.push( renderMember( member, callbackMap ) );

	}

	// Constructor before instance methods
	if ( classDoc.params && classDoc.params.length > 0 ) {

		lines.push( renderConstructor( classDoc, callbackMap ) );

	}

	for ( const method of instanceMethods ) {

		lines.push( renderMethod( method, callbackMap ) );

	}

	return lines.join( '\n' );

}
