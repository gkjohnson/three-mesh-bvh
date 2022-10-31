import { BufferAttribute, BufferGeometry, Vector3, Vector4, Matrix4, Matrix3 } from 'three';

const _positionVector = /*@__PURE__*/ new Vector3();
const _normalVector = /*@__PURE__*/ new Vector3();
const _tangentVector = /*@__PURE__*/ new Vector3();
const _tangentVector4 = /*@__PURE__*/ new Vector4();

const _morphVector = /*@__PURE__*/ new Vector3();
const _temp = /*@__PURE__*/ new Vector3();

const _skinIndex = /*@__PURE__*/ new Vector4();
const _skinWeight = /*@__PURE__*/ new Vector4();
const _matrix = /*@__PURE__*/ new Matrix4();
const _boneMatrix = /*@__PURE__*/ new Matrix4();

// Confirms that the two provided attributes are compatible
function validateAttributes( attr1, attr2 ) {

	if ( ! attr1 && ! attr2 ) {

		return;

	}

	const sameCount = attr1.count === attr2.count;
	const sameNormalized = attr1.normalized === attr2.normalized;
	const sameType = attr1.array.constructor === attr2.array.constructor;
	const sameItemSize = attr1.itemSize === attr2.itemSize;

	if ( ! sameCount || ! sameNormalized || ! sameType || ! sameItemSize ) {

		throw new Error();

	}

}

// Clones the given attribute with a new compatible buffer attribute but no data
function createAttributeClone( attr, countOverride = null ) {

	const cons = attr.array.constructor;
	const normalized = attr.normalized;
	const itemSize = attr.itemSize;
	const count = countOverride === null ? attr.count : countOverride;

	return new BufferAttribute( new cons( itemSize * count ), itemSize, normalized );

}

// target offset is the number of elements in the target buffer stride to skip before copying the
// attributes contents in to.
function copyAttributeContents( attr, target, targetOffset = 0 ) {

	if ( attr.isInterleavedBufferAttribute ) {

		const itemSize = attr.itemSize;
		for ( let i = 0, l = attr.count; i < l; i ++ ) {

			const io = i + targetOffset;
			target.setX( io, attr.getX( i ) );
			if ( itemSize >= 2 ) target.setY( io, attr.getY( i ) );
			if ( itemSize >= 3 ) target.setZ( io, attr.getZ( i ) );
			if ( itemSize >= 4 ) target.setW( io, attr.getW( i ) );

		}

	} else {

		const array = target.array;
		const cons = array.constructor;
		const byteOffset = array.BYTES_PER_ELEMENT * attr.itemSize * targetOffset;
		const temp = new cons( array.buffer, byteOffset, attr.array.length );
		temp.set( attr.array );

	}

}

// Adds the "matrix" multiplied by "scale" to "target"
function addScaledMatrix( target, matrix, scale ) {

	const targetArray = target.elements;
	const matrixArray = matrix.elements;
	for ( let i = 0, l = matrixArray.length; i < l; i ++ ) {

		targetArray[ i ] += matrixArray[ i ] * scale;

	}

}

// A version of "SkinnedMesh.boneTransform" for normals
function boneNormalTransform( mesh, index, target ) {

	const skeleton = mesh.skeleton;
	const geometry = mesh.geometry;
	const bones = skeleton.bones;
	const boneInverses = skeleton.boneInverses;

	_skinIndex.fromBufferAttribute( geometry.attributes.skinIndex, index );
	_skinWeight.fromBufferAttribute( geometry.attributes.skinWeight, index );

	_matrix.elements.fill( 0 );

	for ( let i = 0; i < 4; i ++ ) {

		const weight = _skinWeight.getComponent( i );

		if ( weight !== 0 ) {

			const boneIndex = _skinIndex.getComponent( i );
			_boneMatrix.multiplyMatrices( bones[ boneIndex ].matrixWorld, boneInverses[ boneIndex ] );

			addScaledMatrix( _matrix, _boneMatrix, weight );

		}

	}

	_matrix.multiply( mesh.bindMatrix ).premultiply( mesh.bindMatrixInverse );
	target.transformDirection( _matrix );

	return target;

}

// Applies the morph target data to the target vector
function applyMorphTarget( morphData, morphInfluences, morphTargetsRelative, i, target ) {

	_morphVector.set( 0, 0, 0 );
	for ( let j = 0, jl = morphData.length; j < jl; j ++ ) {

		const influence = morphInfluences[ j ];
		const morphAttribute = morphData[ j ];

		if ( influence === 0 ) continue;

		_temp.fromBufferAttribute( morphAttribute, i );

		if ( morphTargetsRelative ) {

			_morphVector.addScaledVector( _temp, influence );

		} else {

			_morphVector.addScaledVector( _temp.sub( target ), influence );

		}

	}

	target.add( _morphVector );

}

// Modified version of BufferGeometryUtils.mergeBufferGeometries that ignores morph targets and updates a attributes in plac
function mergeBufferGeometries( geometries, options = { useGroups: false, updateIndex: false }, targetGeometry = new BufferGeometry() ) {

	const isIndexed = geometries[ 0 ].index !== null;
	const { useGroups, updateIndex } = options;

	const attributesUsed = new Set( Object.keys( geometries[ 0 ].attributes ) );
	const attributes = {};

	let offset = 0;

	for ( let i = 0; i < geometries.length; ++ i ) {

		const geometry = geometries[ i ];
		let attributesCount = 0;

		// ensure that all geometries are indexed, or none
		if ( isIndexed !== ( geometry.index !== null ) ) {

			throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.' );

		}

		// gather attributes, exit early if they're different
		for ( const name in geometry.attributes ) {

			if ( ! attributesUsed.has( name ) ) {

				throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure "' + name + '" attribute exists among all geometries, or in none of them.' );

			}

			if ( attributes[ name ] === undefined ) {

				attributes[ name ] = [];

			}

			attributes[ name ].push( geometry.attributes[ name ] );
			attributesCount ++;

		}

		// ensure geometries have the same number of attributes
		if ( attributesCount !== attributesUsed.size ) {

			throw new Error( 'StaticGeometryGenerator: Make sure all geometries have the same number of attributes.' );

		}

		if ( useGroups ) {

			let count;
			if ( isIndexed ) {

				count = geometry.index.count;

			} else if ( geometry.attributes.position !== undefined ) {

				count = geometry.attributes.position.count;

			} else {

				throw new Error( 'StaticGeometryGenerator: The geometry must have either an index or a position attribute' );

			}

			targetGeometry.addGroup( offset, count, i );
			offset += count;

		}

	}

	// merge indices
	if ( isIndexed ) {

		let forceUpateIndex = false;
		if ( ! targetGeometry.index ) {

			let indexCount = 0;
			for ( let i = 0; i < geometries.length; ++ i ) {

				indexCount += geometries[ i ].index.count;

			}

			targetGeometry.setIndex( new BufferAttribute( new Uint32Array( indexCount ), 1, false ) );
			forceUpateIndex = true;

		}

		if ( updateIndex || forceUpateIndex ) {

			const targetIndex = targetGeometry.index;
			let targetOffset = 0;
			let indexOffset = 0;
			for ( let i = 0; i < geometries.length; ++ i ) {

				const geometry = geometries[ i ];
				const index = geometry.index;
				for ( let j = 0; j < index.count; ++ j ) {

					targetIndex.setX( targetOffset, index.getX( j ) + indexOffset );
					targetOffset ++;

				}

				indexOffset += geometry.attributes.position.count;

			}

		}

	}

	// merge attributes
	for ( const name in attributes ) {

		const attrList = attributes[ name ];
		if ( ! ( name in targetGeometry.attributes ) ) {

			let count = 0;
			for ( const key in attrList ) {

				count += attrList[ key ].count;

			}

			targetGeometry.setAttribute( name, createAttributeClone( attributes[ name ][ 0 ], count ) );

		}

		const targetAttribute = targetGeometry.attributes[ name ];
		let offset = 0;
		for ( const key in attrList ) {

			const attr = attrList[ key ];
			copyAttributeContents( attr, targetAttribute, offset );
			offset += attr.count;

		}

	}

	return targetGeometry;

}

export class StaticGeometryGenerator {

	constructor( meshes ) {

		if ( ! Array.isArray( meshes ) ) {

			meshes = [ meshes ];

		}

		const finalMeshes = [];
		meshes.forEach( object => {

			object.traverse( c => {

				if ( c.isMesh ) {

					finalMeshes.push( c );

				}

			} );

		} );

		this.meshes = finalMeshes;
		this.useGroups = true;
		this.applyWorldTransforms = true;
		this.attributes = [ 'position', 'normal', 'color', 'tangent', 'uv', 'uv2' ];
		this._intermediateGeometry = new Array( finalMeshes.length ).fill().map( () => new BufferGeometry() );

	}

	getMaterials() {

		const materials = [];
		this.meshes.forEach( mesh => {

			if ( Array.isArray( mesh.material ) ) {

				materials.push( ...mesh.material );

			} else {

				materials.push( mesh.material );

			}

		} );
		return materials;

	}

	generate( targetGeometry = new BufferGeometry() ) {

		const { meshes, useGroups, _intermediateGeometry } = this;
		for ( let i = 0, l = meshes.length; i < l; i ++ ) {

			const mesh = meshes[ i ];
			const geom = _intermediateGeometry[ i ];
			this._convertToStaticGeometry( mesh, geom );

		}

		mergeBufferGeometries( _intermediateGeometry, { useGroups }, targetGeometry );
		for ( const key in targetGeometry.attributes ) {

			targetGeometry.attributes[ key ].needsUpdate = true;

		}

		return targetGeometry;

	}

	_convertToStaticGeometry( mesh, targetGeometry = new BufferGeometry() ) {

		const geometry = mesh.geometry;
		const applyWorldTransforms = this.applyWorldTransforms;
		const includeNormal = this.attributes.includes( 'normal' );
		const includeTangent = this.attributes.includes( 'tangent' );
		const attributes = geometry.attributes;
		const targetAttributes = targetGeometry.attributes;

		// initialize the attributes if they don't exist
		if ( ! targetGeometry.index ) {

			targetGeometry.index = geometry.index;

		}

		if ( ! targetAttributes.position ) {

			targetGeometry.setAttribute( 'position', createAttributeClone( attributes.position ) );

		}

		if ( includeNormal && ! targetAttributes.normal && attributes.normal ) {

			targetGeometry.setAttribute( 'normal', createAttributeClone( attributes.normal ) );

		}

		if ( includeTangent && ! targetAttributes.tangent && attributes.tangent ) {

			targetGeometry.setAttribute( 'tangent', createAttributeClone( attributes.tangent ) );

		}

		// ensure the attributes are consistent
		validateAttributes( geometry.index, targetGeometry.index );
		validateAttributes( attributes.position, targetAttributes.position );

		if ( includeNormal ) {

			validateAttributes( attributes.normal, targetAttributes.normal );

		}

		if ( includeTangent ) {

			validateAttributes( attributes.tangent, targetAttributes.tangent );

		}

		// generate transformed vertex attribute data
		const position = attributes.position;
		const normal = includeNormal ? attributes.normal : null;
		const tangent = includeTangent ? attributes.tangent : null;
		const morphPosition = geometry.morphAttributes.position;
		const morphNormal = geometry.morphAttributes.normal;
		const morphTangent = geometry.morphAttributes.tangent;
		const morphTargetsRelative = geometry.morphTargetsRelative;
		const morphInfluences = mesh.morphTargetInfluences;
		const normalMatrix = new Matrix3();
		normalMatrix.getNormalMatrix( mesh.matrixWorld );

		for ( let i = 0, l = attributes.position.count; i < l; i ++ ) {

			_positionVector.fromBufferAttribute( position, i );
			if ( normal ) {

				_normalVector.fromBufferAttribute( normal, i );

			}

			if ( tangent ) {

				_tangentVector4.fromBufferAttribute( tangent, i );
				_tangentVector.fromBufferAttribute( tangent, i );

			}

			// apply morph target transform
			if ( morphInfluences ) {

				if ( morphPosition ) {

					applyMorphTarget( morphPosition, morphInfluences, morphTargetsRelative, i, _positionVector );

				}

				if ( morphNormal ) {

					applyMorphTarget( morphNormal, morphInfluences, morphTargetsRelative, i, _normalVector );

				}

				if ( morphTangent ) {

					applyMorphTarget( morphTangent, morphInfluences, morphTargetsRelative, i, _tangentVector );

				}

			}

			// apply bone transform
			if ( mesh.isSkinnedMesh ) {

				mesh.boneTransform( i, _positionVector );
				if ( normal ) {

					boneNormalTransform( mesh, i, _normalVector );

				}

				if ( tangent ) {

					boneNormalTransform( mesh, i, _tangentVector );

				}

			}

			// update the vectors of the attributes
			if ( applyWorldTransforms ) {

				_positionVector.applyMatrix4( mesh.matrixWorld );

			}

			targetAttributes.position.setXYZ( i, _positionVector.x, _positionVector.y, _positionVector.z );

			if ( normal ) {

				if ( applyWorldTransforms ) {

					_normalVector.applyNormalMatrix( normalMatrix );

				}

				targetAttributes.normal.setXYZ( i, _normalVector.x, _normalVector.y, _normalVector.z );

			}

			if ( tangent ) {

				if ( applyWorldTransforms ) {

					_tangentVector.transformDirection( mesh.matrixWorld );

				}

				targetAttributes.tangent.setXYZW( i, _tangentVector.x, _tangentVector.y, _tangentVector.z, _tangentVector4.w );

			}

		}

		// copy other attributes over
		for ( const i in this.attributes ) {

			const key = this.attributes[ i ];
			if ( key === 'position' || key === 'tangent' || key === 'normal' || ! ( key in attributes ) ) {

				continue;

			}

			if ( ! targetAttributes[ key ] ) {

				targetGeometry.setAttribute( key, createAttributeClone( attributes[ key ] ) );

			}

			validateAttributes( attributes[ key ], targetAttributes[ key ] );
			copyAttributeContents( attributes[ key ], targetAttributes[ key ] );

		}

		return targetGeometry;

	}

}
