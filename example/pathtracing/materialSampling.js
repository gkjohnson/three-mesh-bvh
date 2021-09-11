export function getBSDFDirection( ray, hit, material, rayTarget ) {

	const { ior, metalness, roughness, transmission } = material;

	// TODO:
	// using reflectance, metalness, roughness, ior, transmission determine
	// the probability of each type of ray (transmissive, specular, diffuse) of
	// being used. Use a random number to select the incident ray.

	// TODO:
	// We need to return our PDF for this direction so we can multiply it into our result
	// to offset the PDF weighting from the BSDF color hit
	// https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html#importancesamplingmaterials

}

export function getBSDFColorFromHit( ray, hit, material, incidentColor, colorTarget ) {

	const { ior, metalness, roughness, transmission } = material;

	// TODO:
	// use reflectance, metalness, roughness, ior, transmission, emission determine
	// the color contribution from the material given the incidentColor to the colorTarget.
	// Account for contributions from transmissive, specular, and diffuse BRDFs

	// TODO: how do we determine the weight for something like diffuse when it's been tempered by
	// the direction sampling (cosine weighted) already? Does it need to be cosine weighted here, too?
	// (read area light sampling section)

}

