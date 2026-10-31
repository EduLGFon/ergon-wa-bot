// chunk - text chunking/wrapping helpers for mobile-friendly output.
// - splits long text into WhatsApp/TG-safe chunks and wraps long lines.
export function chunkText(text: str, max = 3500): str[] {
	const chunks: str[] = []
	if (!text) return chunks
	let rest = text
	while (rest.length > max) {
		let cut = rest.lastIndexOf('\n', max)
		if (cut <= 0) cut = max
		chunks.push(rest.slice(0, cut))
		rest = rest.slice(cut).replace(/^\n/, '')
	}
	if (rest.length) chunks.push(rest)
	return chunks
}

export function wrapLines(text: str, width = 90): str {
	return text
		.split('\n')
		.map((line) => {
			if (line.length <= width) return line
			const out: str[] = []
			let rest = line
			while (rest.length > width) {
				let cut = rest.lastIndexOf(' ', width)
				if (cut <= 0) cut = width
				out.push(rest.slice(0, cut))
				rest = rest.slice(cut).trimStart()
			}
			if (rest.length) out.push(rest)
			return out.join('\n')
		})
		.join('\n')
}
