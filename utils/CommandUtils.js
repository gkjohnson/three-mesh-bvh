import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Walks up the directory hierarchy from the given path or file URL until a package.json is found.
 * Throws if no package.json is found before reaching the filesystem root.
 * @param {string} urlOrPath - Directory path or file URL (e.g. import.meta.url) to start searching from
 * @returns {string}
 */
export function findRootDir( urlOrPath = import.meta.url ) {

	const dir = urlOrPath.startsWith( 'file://' ) ? dirname( fileURLToPath( urlOrPath ) ) : urlOrPath;
	if ( existsSync( join( dir, 'package.json' ) ) ) return dir;

	const parent = dirname( dir );
	if ( parent === dir ) throw new Error( 'Could not find package.json' );

	return findRootDir( parent );

}
