/**
 * @purpose Joist wordmark — Fraunces display with single italic-touch in the
 * descender of the 'j', preceded by the chartreuse stroke from the deployed
 * brand demo. No symbol; the wordmark is the mark.
 *
 * Per memory/brand_decisions.md: "Plain wordmark, Fraunces display weight,
 * single italic-touch in the descender." Pattern follows Linear / Vercel /
 * Resend / Anthropic — confident wordmark, no logo-mark needed.
 */
export default function JoistMark( { size = 'md', className = '' } ) {
	const fontSize = size === 'sm' ? 20 : size === 'lg' ? 40 : 28;
	const strokeWidth = size === 'sm' ? 2 : size === 'lg' ? 4 : 3;

	return (
		<span
			className={ `joist-mark joist-mark--${ size } ${ className }` }
			role="img"
			aria-label="Joist"
			style={ { fontSize: `${ fontSize }px` } }
		>
			<span
				className="joist-mark__stroke"
				aria-hidden="true"
				style={ {
					width: `${ fontSize * 0.45 }px`,
					height: `${ strokeWidth }px`,
				} }
			/>
			<span className="joist-mark__word">
				<span className="joist-mark__j">j</span>oist
			</span>
		</span>
	);
}
