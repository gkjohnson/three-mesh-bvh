/**
 * GPU Sorting Module
 *
 * Provides GPU radix sort implementations.
 * - OneSweepSorter: High-performance implementation (15 elements/thread, subgroup ops)
 */

export { BaseSorter } from './BaseSorter.js';
export { OneSweepSorter } from './OneSweepSorter.js';

/**
 * Available sorter types for configuration
 */
export const SorterType = {
	ONESWEEP: 'onesweep',
};
