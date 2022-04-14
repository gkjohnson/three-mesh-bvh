import { BufferAttribute, BufferGeometry } from 'three';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function validateAttributes( attr1, attr2 ) {

	const sameCount = attr1.count === attr2.count;
	const sameNormalized = attr1.normalized === attr2.normalized;
	const sameType = attr1.array.constructor === attr2.array.constructor;
	const sameItemSize = attr1.itemSize === attr2.itemSize;

	if ( ! sameCount || ! sameNormalized || ! sameType || ! sameItemSize ) {

		throw new Error();

	}

}

function createAttributeClone( attr ) {

	const cons = attr.array.constructor;
	const normalized = attr.normalized;
	const itemSize = attr.itemSize;
	const count = attr.count;

	return new BufferAttribute( new cons( itemSize * count ), itemSize, normalized );

}

export class StaticMeshGenerator {

	constructor( meshes ) {

		if ( ! Array.isArray( meshes ) ) {

			meshes = [ meshes ];

		}

		this.meshes = meshes;
		this.retainGroups = false;
		this.applyWorldTransforms = true;
		this._intermediateGeometry = new Array( meshes.length ).fill( new BufferGeometry() );

	}

	generate( targetGeometry = new BufferGeometry() ) {

		const { meshes, retainGroups, _intermediateGeometry } = this;
		for ( let i = 0, l = meshes.length; i < l; i ++ ) {

			const mesh = meshes[ i ];
			const geom = _intermediateGeometry[ i ];
			this._convertToStaticGeometry( mesh, geom );

		}

		// TODO: change merge buffer geometries so it can be applied to an existing geometry
		targetGeometry = mergeBufferGeometries( _intermediateGeometry, retainGroups, targetGeometry );
		targetGeometry.needsUpdate = true;

		return targetGeometry;

	}

	_convertToStaticGeometry( mesh, targetGeometry = new BufferGeometry() ) {

		const geometry = mesh.geometry;
		if ( ! targetGeometry.index ) {

			targetGeometry.index = geometry.index;

		}

		if ( ! targetGeometry.attributes.position ) {

			targetGeometry.setAttribute( 'position', createAttributeClone( geometry.attributes.position ) );

		}

		if ( ! targetGeometry.attributes.normal && geometry.attributes.normal ) {

			targetGeometry.setAttribute( 'normal', createAttributeClone( geometry.attributes.normal ) );

		}

		if ( ! targetGeometry.attributes.tangent && geometry.attributes.tangent ) {

			targetGeometry.setAttribute( 'tangent', createAttributeClone( geometry.attributes.tangent ) );

		}

		validateAttributes( geometry.index, targetGeometry.index );
		validateAttributes( geometry.attributes.position, targetGeometry.attributes.position );
		validateAttributes( geometry.attributes.normal, targetGeometry.attributes.normal );
		validateAttributes( geometry.attributes.tangent, targetGeometry.attributes.tangent );

		// TODO: fill with baked geometry

	}

}
