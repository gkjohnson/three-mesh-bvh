import { logTable } from './logTable.js';

let _maxTime = 3000;
let _maxIterations = 100;
let _prewarmIterations = 5;

const _beforeAll = [];
const _beforeEach = [];
const _afterAll = [];
const _afterEach = [];
const _bench = [];

const _suites = [];

function findMedian( values ) {

	values.sort( ( a, b ) => a - b );
	const length = values.length;
	if ( length % 2 === 1 ) {

		return values[ Math.floor( length / 2 ) ];

	} else {

		const v1 = values[ length / 2 - 1 ];
		const v2 = values[ length / 2 ];
		return ( v1 + v2 ) / 2;

	}

}

export function suite( name, cb ) {

	cb();

	_beforeAll.forEach( cb => cb() );
	let results = [];
	for ( let i = 0, l = _bench.length; i < l; i ++ ) {

		_beforeEach.forEach( cb => cb() );

		let iterations = 0;
		let elapsed = 0;
		let minTime = Infinity;
		let maxTime = - Infinity;
		let times = [];
		let delta, start;
		const { name, run, prerun } = _bench[ i ];

		for ( let j = 0; j < _prewarmIterations; j ++ ) {

			if ( prerun ) prerun();
			run();

		}

		while ( elapsed < _maxTime ) {

			if ( prerun ) prerun();
			start = performance.now();
			run();
			delta = performance.now() - start;
			elapsed += delta;

			iterations ++;
			maxTime = Math.max( maxTime, delta );
			minTime = Math.min( minTime, delta );
			times.push( delta );

			if ( iterations >= _maxIterations ) break;

		}

		_afterEach.forEach( cb => cb() );

		results.push( {
			name,
			mean: elapsed / iterations,
			median: findMedian( times ),
			min: minTime,
			max: maxTime,
			iterations,
		} );

	}

	_afterAll.forEach( cb => cb() );

	_suites.push( { name, results } );

	logTable( _suites[ 0 ] );//, [ 'mean', 'median', 'min', 'max' ] );
	_suites.length = 0;

	_afterAll.length = 0;
	_afterEach.length = 0;
	_beforeAll.length = 0;
	_beforeEach.length = 0;
	_bench.length = 0;

}

export function bench( name, prerun, run ) {

	if ( run === undefined ) {

		run = prerun;
		prerun = undefined;

	}

	_bench.push( { prerun, run, name } );

}

export function beforeAll( cb ) {

	_beforeAll.push( cb );

}

export function beforeEach( cb ) {

	_beforeEach.push( cb );

}

export function afterEach( cb ) {

	_afterEach.push( cb );

}

export function afterAll( cb ) {

	_afterAll.push( cb );

}
