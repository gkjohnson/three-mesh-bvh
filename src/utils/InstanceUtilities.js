// Calls the callback with the id of every instance of an InstancedMesh or BatchedMesh, skipping deleted
// BatchedMesh instances, or once with 0 for any other object.
export function forEachInstance( object, callback ) {

	if ( object.isInstancedMesh ) {

		for ( let i = 0, l = object.count; i < l; i ++ ) {

			callback( i );

		}

	} else if ( object.isBatchedMesh ) {

		const { instanceCount, maxInstanceCount } = object;
		let foundInstances = 0;
		for ( let i = 0; i < maxInstanceCount && foundInstances < instanceCount; i ++ ) {

			if ( isInstanceActive( object, i ) ) {

				callback( i );
				foundInstances ++;

			}

		}

	} else {

		callback( 0 );

	}

}

// TODO: it would be better to have a consistent way of querying whether an instance were active
function isInstanceActive( object, instanceId ) {

	try {

		object.getVisibleAt( instanceId );
		return true;

	} catch {

		return false;

	}

}
