import { Mesh, Raycaster } from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';

describe( 'acceleratedRaycast', () => {

	it( 'should be resilient to a custom type field', () => {

		const mesh = new Mesh();
		mesh.raycast = acceleratedRaycast;
		mesh.type = 'CUSTOM_MESH';

		const callback = () => {

			const raycaster = new Raycaster();
			raycaster.intersectObject( mesh );

		};

		expect( callback ).not.toThrow();

	} );

} );
