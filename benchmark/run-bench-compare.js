import simpleGit from 'simple-git';
import { exec } from 'child_process';

const CRITICAL_ONLY = process.argv.includes( '--critical' );
( async() => {

	const git = simpleGit();
	const status = await git.status();

	const modified = status.modified.length + status.created.length + status.renamed.length + status.deleted.length;
	if ( modified !== 0 ) {

		console.error( 'Current branch is not clean' );
		process.exit( 1 );

	}

	const currentBranch = status.current;
	await runScript( 'node ./benchmark/run-benchmark.js --long --json > pr-benchmark.json' );
	await git.checkout( 'master' );
	await runScript( 'node ./benchmark/run-benchmark.js --long --json > master-benchmark.json' );
	await runScript( 'node ./benchmark/compare-bench-json.js' + ( CRITICAL_ONLY ? ' --critical' : '' ) );

	await git.checkout( currentBranch );

} )();

function runScript( command ) {

	return new Promise( ( resolve, reject ) => {

		const proc = exec( command );
		proc.stderr.pipe( process.stderr );
		proc.stdout.pipe( process.stdout );
		proc.on( 'exit', code => {

			if ( code === 0 ) resolve();
			else reject();

		} );

	} );

}
