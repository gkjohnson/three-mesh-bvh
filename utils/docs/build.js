import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { renderClass, renderTypedef, renderConstants, renderFunctions, toAnchor, resolveLinks } from './RenderDocsUtils.js';
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
const isConstant = d => d.kind === 'constant' && ! d.memberof;
const isFunction = d => d.kind === 'function' && ! d.memberof;

// Only classes and non-callback typedefs get sections (and therefore anchors) in the output.
const typeRegistry = {}; // name -> output path
for ( const { entry, jsdoc } of results ) {

	for ( const d of jsdoc ) {

		if ( isClass( d ) || isObjectTypedef( d ) ) {

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

	// Sort classes so base classes appear before subclasses
	const classes = jsdoc
		.filter( d => isClass( d ) )
		.sort( ( a, b ) => {

			const aIsBase = ! a.augments || a.augments.length === 0;
			const bIsBase = ! b.augments || b.augments.length === 0;
			if ( aIsBase && ! bIsBase ) return - 1;
			if ( ! aIsBase && bIsBase ) return 1;
			return a.name.localeCompare( b.name );

		} );

	// collect @callback typedefs into a map for inline substitution
	const callbackMap = {};
	for ( const d of jsdoc ) {

		if ( isCallbackTypedef( d ) ) {

			callbackMap[ d.name ] = d;

		}

	}

	// Sort typedefs so plain-object bases appear before derived types; exclude @callback entries
	const typedefs = jsdoc
		.filter( d => isObjectTypedef( d ) )
		.sort( ( a, b ) => {

			const aIsBase = a.type.names[ 0 ] === 'Object';
			const bIsBase = b.type.names[ 0 ] === 'Object';
			if ( aIsBase && ! bIsBase ) return - 1;
			if ( ! aIsBase && bIsBase ) return 1;
			return a.name.localeCompare( b.name );

		} );

	// sort constants by source line order
	const constants = jsdoc
		.filter( d => isConstant( d ) )
		.sort( ( a, b ) => a.meta.lineno - b.meta.lineno );

	// group standalone functions by @group tag (or 'Functions' if untagged)
	const funcsByGroup = {};
	for ( const d of jsdoc.filter( isFunction ).sort( ( a, b ) => a.meta.lineno - b.meta.lineno ) ) {

		const groupTag = d.tags && d.tags.find( t => t.title === 'group' );
		const groupName = groupTag ? groupTag.value : 'Functions';
		if ( ! funcsByGroup[ groupName ] ) funcsByGroup[ groupName ] = [];
		funcsByGroup[ groupName ].push( d );

	}

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

	// construct the output file
	const sections = [ `# ${ entry.title }`, '' ];

	sections.push( renderConstants( constants, callbackMap ) );

	for ( const cls of classes ) {

		sections.push( renderClass( cls, classMembers[ cls.name ] || [], callbackMap, resolveLink ) );

	}

	for ( const typedef of typedefs ) {

		sections.push( renderTypedef( typedef, callbackMap, resolveLink ) );

	}

	for ( const [ groupName, funcs ] of Object.entries( funcsByGroup ) ) {

		sections.push( renderFunctions( funcs, groupName, callbackMap ) );

	}

	const header = '<!-- This file is generated automatically. Do not edit it directly. -->\n';
	const output = header + resolveLinks( sections.join( '\n' ) );
	fs.writeFileSync( path.join( ROOT_DIR, entry.output ), output );
	console.log( `Written: ${ entry.output }` );

}

//

function runJsDoc( source ) {

	// Default maxBuffer is 1 MB; large source directories can exceed that, so raise it to 32 MB.
	const result = execSync( `npx jsdoc -X -r "${ source }"`, { maxBuffer: 32 * 1024 * 1024 } ).toString();
	return JSON.parse( result );

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
