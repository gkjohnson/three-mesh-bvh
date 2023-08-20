const LONG_RUNNING = process.argv.includes( '--long' );
const LOG_JSON = process.argv.includes( '--json' );
const jsonLog = [];
const MAX_TIME = LONG_RUNNING ? 60000 : 3000;
const MAX_ITER = LONG_RUNNING ? 10000 : 100;

function log( key, value = null ) {

	if ( LOG_JSON ) {

		jsonLog.push( { key, value } );

	} else {

		if ( value === null ) {

			console.log( key );

		} else {

			console.log( `${ key }: ${ value }` );

		}

	}

}

function finishLog() {

	if ( LOG_JSON ) {

		console.log( JSON.stringify( jsonLog, null, '\t' ) );
		jsonLog.length = 0;

	}

}

function pad( str, len ) {

	let res = str;
	while ( res.length < len ) {

		res += ' ';

	}

	return res;

}

function runBenchmark( name, preFunc, func, maxTime = MAX_TIME, maxIterations = MAX_ITER ) {

	let iterations = 0;
	let elapsed = 0;
	while ( elapsed < maxTime ) {

		if ( preFunc ) preFunc();
		let start = performance.now();
		func();
		elapsed += performance.now() - start;

		iterations ++;
		if ( iterations >= maxIterations ) break;

	}

	log( `\t${ pad( name, 25 ) }`, `${ parseFloat( ( elapsed / iterations ).toFixed( 6 ) ) } ms` );

}

export { pad, runBenchmark, log, finishLog };
