function pad( str, len ) {

	let res = str;
	while ( res.length < len ) {

		res += ' ';

	}

	return res;

}

function runBenchmark( name, preFunc, func, maxTime, maxIterations = 100 ) {

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

	console.log( `\t${ pad( name, 25 ) }: ${ parseFloat( ( elapsed / iterations ).toFixed( 6 ) ) } ms` );

}

export { pad, runBenchmark };
