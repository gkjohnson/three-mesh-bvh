export function getBSDFDirection( ray, hit, material, rayTarget ) {

	const { ior, metalness, roughness, transmission } = material;

	// TODO:
	// using reflectance, metalness, roughness, ior, transmission determine
	// the probability of each type of ray (transmissive, specular, diffuse) of
	// being used. Use a random number to select the incident ray.

}

export function getBSDFColorFromHit( ray, hit, material, incidentColor, colorTarget ) {

	const { ior, metalness, roughness, transmission } = material;

	// TODO:
	// use reflectance, metalness, roughness, ior, transmission, emission determine
	// the color contribution from the material given the incidentColor to the colorTarget.
	// Account for contributions from transmissive, specular, and diffuse BRDFs

}

