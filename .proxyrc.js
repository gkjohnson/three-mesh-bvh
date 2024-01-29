// Proxy serve so SharedArrayBuffer works locally
export default function( app ) {

	app.use( ( req, res, next ) => {

		res.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' );
		res.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' );

		next();

	} );

}
