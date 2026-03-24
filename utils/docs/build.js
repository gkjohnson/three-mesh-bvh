import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { renderClass, renderComponent, renderTypedef, renderConstants, renderFunctions, toAnchor, resolveLinks } from './RenderDocsUtils.js';
import { findRootDir } from '../CommandUtils.js';

const ROOT_DIR = findRootDir();

const ENTRY_POINTS = [
	{
		output: 'API.md',
		title: 'three-mesh-bvh',
		source: 'src',
	},
];

// Run JSDoc for all entry points and build a global type registry for cross-file links
const results = ENTRY_POINTS.map( entry => ( {
	entry,
	jsdoc: filterDocumented( runJsDoc( path.resolve( ROOT_DIR, entry.source ) ) )
} ) );

// Doclet type predicates
const isClass = d => d.kind === 'class';
const isObjectTypedef = d => d.kind === 'typedef' && d.type.names[ 0 ] !== 'function';
const isCallbackTypedef = d => d.kind === 'typedef' && d.type.names[ 0 ] === 'function';
const isReactComponent = d => ( d.kind === 'function' || d.kind === 'constant' ) && d.tags && d.tags.some( t => t.title === 'component' );
const isConstant = d => d.kind === 'constant' && ! d.memberof && ! isReactComponent( d );
const isFunction = d => d.kind === 'function' && ! d.memberof && ! isReactComponent( d );

// Only classes, non-callback typedefs, and React components get sections (and therefore anchors) in the output.
const typeRegistry = {}; // name -> output path
for ( const { entry, jsdoc } of results ) {

	for ( const d of jsdoc ) {

		if ( isClass( d ) || isObjectTypedef( d ) || isReactComponent( d ) ) {

			typeRegistry[ d.name ] = entry.output;

		}

	}

}

// Pass 2: render each entry point.
for ( const { entry, jsdoc } of results ) {

	const resolveLink = name => {

		// no link
		const targetFile = typeRegistry[ name ];
		if ( ! targetFile ) {

			return null;

		}

		const anchor = `#${ toAnchor( name ) }`;
		if ( targetFile === entry.output ) {

			// anchor is in the same file
			return anchor;

		}

		// relative path + anchor for a different file
		const fromDir = path.dirname( path.join( ROOT_DIR, entry.output ) );
		const toFile = path.join( ROOT_DIR, targetFile );
		const relativePath = path.relative( fromDir, toFile ).replace( /\\/g, '/' );
		return relativePath + anchor;

	};

	// Sort classes topologically so every parent appears before its subclasses.
	// Within the same "depth level" classes are sorted alphabetically.
	const classes = topologicalSortClasses( jsdoc.filter( d => isClass( d ) ) );

	// collect @callback typedefs into a map for inline substitution
	const callbackMap = {};
	for ( const d of jsdoc ) {

		if ( isCallbackTypedef( d ) ) {

			callbackMap[ d.name ] = d;

		}

	}

	// Sort typedefs so plain-object bases appear before derived types; exclude @callback entries
	const allTypedefs = jsdoc
		.filter( d => isObjectTypedef( d ) )
		.sort( ( a, b ) => {

			const aIsBase = a.type.names[ 0 ] === 'Object';
			const bIsBase = b.type.names[ 0 ] === 'Object';
			if ( aIsBase && ! bIsBase ) return - 1;
			if ( ! aIsBase && bIsBase ) return 1;
			return a.name.localeCompare( b.name );

		} );

	// Typedefs tagged with @section are injected before their matching function group
	const typedefsBySection = {};
	const typedefs = [];
	for ( const d of allTypedefs ) {

		const sectionTag = d.tags && d.tags.find( t => t.title === 'section' );
		if ( sectionTag ) {

			const key = sectionTag.value;
			if ( ! typedefsBySection[ key ] ) typedefsBySection[ key ] = [];
			typedefsBySection[ key ].push( d );

		} else {

			typedefs.push( d );

		}

	}

	// sort components by source line order
	const components = jsdoc
		.filter( d => isReactComponent( d ) )
		.sort( ( a, b ) => a.meta.lineno - b.meta.lineno );

	const constsByGroup = groupByTag( jsdoc, isConstant, 'Constants' );
	const funcsByGroup = groupByTag( jsdoc, isFunction, 'Functions' );

	// cache all fields by associated class name
	const classMembers = {};
	for ( const doc of jsdoc ) {

		if ( doc.memberof && doc.kind !== 'class' ) {

			if ( ! classMembers[ doc.memberof ] ) {

				classMembers[ doc.memberof ] = [];

			}

			classMembers[ doc.memberof ].push( doc );

		}

	}

	// construct the readme files
	const sections = [ `# ${ entry.title }`, '' ];

	for ( const [ groupName, consts ] of Object.entries( constsByGroup ) ) {

		sections.push( renderConstants( consts, groupName, callbackMap ) );

	}

	for ( const component of components ) {

		sections.push( renderComponent( component, callbackMap ) );

	}

	for ( const cls of classes ) {

		sections.push( renderClass( cls, classMembers[ cls.name ] || [], callbackMap, resolveLink ) );

	}

	for ( const typedef of typedefs ) {

		sections.push( renderTypedef( typedef, callbackMap, resolveLink ) );

	}

	for ( const [ groupName, funcs ] of Object.entries( funcsByGroup ) ) {

		const sectionTypedefs = typedefsBySection[ groupName ] || [];
		sections.push( renderFunctions( funcs, groupName, callbackMap, sectionTypedefs, callbackMap, resolveLink ) );

	}

	const header = '<!-- This file is generated automatically. Do not edit it directly. -->\n';
	const output = header + resolveLinks( sections.join( '\n' ) );
	fs.writeFileSync( path.join( ROOT_DIR, entry.output ), output );
	console.log( `Written: ${ entry.output }` );

}

//

function groupByTag( docs, predicate, defaultGroup ) {

	const groups = {};
	for ( const d of docs.filter( predicate ).sort( ( a, b ) => a.meta.lineno - b.meta.lineno ) ) {

		const groupTag = d.tags && d.tags.find( t => t.title === 'section' );
		const groupName = groupTag ? groupTag.value : defaultGroup;
		if ( ! groups[ groupName ] ) groups[ groupName ] = [];
		groups[ groupName ].push( d );

	}

	return groups;

}

function runJsDoc( source ) {

	// Default maxBuffer is 1 MB; large source directories can exceed that, so raise it to 32 MB.
	const result = execSync( `npx jsdoc -X -r "${ source }"`, { maxBuffer: 32 * 1024 * 1024 } ).toString();
	return JSON.parse( result );

}

// Topological sort: every parent class appears before its subclasses.
// Siblings (subclasses sharing the same parent) are kept together and ordered alphabetically.
function topologicalSortClasses( classes ) {

	const byName = Object.fromEntries( classes.map( c => [ c.name, c ] ) );
	const result = [];
	const visited = new Set();

	// Build parent -> children map so siblings can be visited eagerly
	const childrenMap = {};
	for ( const cls of classes ) {

		for ( const parent of ( cls.augments || [] ) ) {

			if ( ! childrenMap[ parent ] ) childrenMap[ parent ] = [];
			childrenMap[ parent ].push( cls );

		}

	}

	function visit( cls ) {

		if ( visited.has( cls.name ) ) return;
		visited.add( cls.name );

		// Visit parent(s) first
		for ( const parent of ( cls.augments || [] ) ) {

			if ( byName[ parent ] ) visit( byName[ parent ] );

		}

		result.push( cls );

		// Eagerly visit children alphabetically so all siblings stay grouped together
		const children = ( childrenMap[ cls.name ] || [] )
			.slice()
			.sort( ( a, b ) => a.name.localeCompare( b.name ) );
		for ( const child of children ) {

			visit( child );

		}

	}

	// Alphabetical pre-sort for deterministic output within the same generation
	[ ...classes ]
		.sort( ( a, b ) => a.name.localeCompare( b.name ) )
		.forEach( visit );

	return result;

}

function filterDocumented( json ) {

	return json.filter( d =>
		d.undocumented !== true &&
		d.ignore !== true &&
		d.kind !== 'package' &&
		d.access !== 'private' &&
		d.inherited !== true &&
		! d.deprecated
	);

}
