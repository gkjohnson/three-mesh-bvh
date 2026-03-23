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

			const type = tag.title === 'warn' ? 'WARN' : 'NOTE';
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

export function renderConstructor( classDoc, callbackMap = {} ) {

	const lines = [];

	const topLevel = ( classDoc.params || [] ).filter( p => ! p.name.includes( '.' ) );
	const options = ( classDoc.params || [] ).filter( p => p.name.includes( '.' ) );

	// When there is exactly one top-level param and nested option fields, render the
	// options inline as a destructured object rather than as a separate bullet list.
	const isOptionsObject = topLevel.length === 1 && options.length > 0;

	lines.push( '### .constructor' );
	lines.push( '' );
	lines.push( '```js' );

	if ( isOptionsObject ) {

		lines.push( 'constructor( {' );
		for ( const param of options ) {

			const name = param.name.split( '.' ).pop();
			const type = formatType( param.type, callbackMap );
			const defStr = param.defaultvalue !== undefined ? ` = ${ param.defaultvalue }` : '';
			const optional = param.optional && param.defaultvalue === undefined ? '?' : '';
			lines.push( `\t${ name }${ defStr }${ optional }: ${ type },` );

		}

		lines.push( '} )' );

	} else {

		const sig = topLevel.map( p => formatParam( p, callbackMap ) ).join( ', ' );
		lines.push( `constructor( ${ sig } )` );

	}

	lines.push( '```' );
	lines.push( '' );

	// Constructor description (JSDoc puts it in `description`, not `classdesc`)
	if ( classDoc.description ) {

		lines.push( classDoc.description );
		lines.push( '' );

	}

	// Bullet list only used for the non-options-object case (e.g. mixed positional + nested params)
	if ( ! isOptionsObject && options.length > 0 ) {

		for ( const param of options ) {

			const name = param.name.split( '.' ).pop();
			const type = formatType( param.type, callbackMap );
			const defStr = param.defaultvalue !== undefined ? ` = ${ param.defaultvalue }` : '';
			lines.push( `- \`${ name }${ defStr }: ${ type }\` — ${ param.description }` );

		}

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

export function renderMethod( doc, callbackMap = {} ) {

	const lines = [];

	lines.push( `### .${ doc.name }` );
	lines.push( '' );
	lines.push( '```js' );

	const params = ( doc.params || [] ).map( p => formatParam( p, callbackMap ) );
	const ret = ( doc.returns && doc.returns[ 0 ] )
		? formatType( doc.returns[ 0 ].type, callbackMap )
		: 'void';

	const singleLine = params.length
		? `${ doc.name }( ${ params.join( ', ' ) } ): ${ ret }`
		: `${ doc.name }(): ${ ret }`;

	if ( singleLine.length > 80 ) {

		lines.push( `${ doc.name }(` );
		params.forEach( ( p, i ) => {

			const comma = i < params.length - 1 ? ',' : '';
			lines.push( `\t${ p }${ comma }` );

		} );
		lines.push( `): ${ ret }` );

	} else {

		lines.push( singleLine );

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

export function renderConstants( constants, callbackMap = {} ) {

	if ( constants.length === 0 ) return '';

	const lines = [];

	lines.push( '## Constants' );
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

export function renderTypedef( typeDoc, callbackMap = {}, resolveLink = null ) {

	const lines = [];

	lines.push( `## ${ typeDoc.name }` );
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
		lines.push( `### .${ prop.name }` );
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

	if ( classDoc.description ) {

		lines.push( classDoc.description );
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
	const methods = visible
		.filter( m => m.kind === 'function' && ! m.type )
		.sort( ( a, b ) => a.meta.lineno - b.meta.lineno );
	const events = visible
		.filter( m => m.kind === 'event' )
		.sort( ( a, b ) => a.meta.lineno - b.meta.lineno );

	if ( events.length > 0 ) {

		lines.push( renderEvents( events, callbackMap ) );

	}

	for ( const member of properties ) {

		lines.push( renderMember( member, callbackMap ) );

	}

	// Constructor before other methods
	if ( classDoc.params && classDoc.params.length > 0 ) {

		lines.push( renderConstructor( classDoc, callbackMap ) );

	}

	for ( const method of methods ) {

		lines.push( renderMethod( method, callbackMap ) );

	}

	return lines.join( '\n' );

}
