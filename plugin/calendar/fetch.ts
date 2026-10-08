// fetch - calendar link scraping and pdf download
export async function fetchCalendarLinks(
	year: number,
): Promise<{ base: string; resolutions: string[] }> {
	const url = 'https://prograd.ufes.br/calendario'
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
	if (!res.ok) throw new Error(`Failed to fetch ${url}`)
	const html = await res.text()
	const baseRegex = new RegExp(
		`<a[^>]*href="([^"]+)"[^>]*>\\s*-\\s*${year}\\s*</a>\\s*-\\s*Cursos presenciais`,
		'i',
	)
	const baseMatch = html.match(baseRegex)
	if (!baseMatch) {
		throw new Error(`Could not find base calendar for ${year} - Cursos presenciais`)
	}
	let baseLink = baseMatch[1]
	if (baseLink.startsWith('/')) baseLink = 'https://prograd.ufes.br' + baseLink
	const resolutions: string[] = []
	const htmlAfter = html.slice(baseMatch.index! + baseMatch[0].length)
	const paragraphs = htmlAfter.split('</p>')
	for (const p of paragraphs) {
		if (p.includes('rteindent1') && p.includes('href="')) {
			const linkMatch = p.match(/<a[^>]*href="([^"]+)"/i)
			if (linkMatch) {
				let link = linkMatch[1]
				if (link.toLowerCase().includes('.pdf')) {
					if (link.startsWith('/')) link = 'https://prograd.ufes.br' + link
					resolutions.push(link)
				}
			}
		} else if (p.trim().length > 0 && !p.includes('rteindent1') && !p.includes('<br')) {
			const textContent = p.replace(/<[^>]+>/g, '').trim()
			if (
				textContent.length > 5 || p.includes('<h') ||
				p.includes('Cursos EAD') || p.includes('Anteriores:')
			) {
				break
			}
		}
	}
	return { base: baseLink, resolutions: resolutions.reverse() }
}

export async function downloadAndConvertPdf(url: string, destTxt: string): Promise<string> {
	const destPdf = destTxt.replace('.txt', '.pdf')
	const curl = new Deno.Command('curl', {
		args: ['-sL', '--max-time', '60', url, '-o', destPdf],
	})
	const curlOut = await curl.output()
	if (!curlOut.success) {
		const err = new TextDecoder().decode(curlOut.stderr).trim()
		throw new Error(`curl failed for ${url} code ${curlOut.code}: ${err}`)
	}
	const pdf = new Deno.Command('pdftotext', { args: ['-layout', destPdf, destTxt] })
	const pdfOut = await pdf.output()
	if (!pdfOut.success) {
		const err = new TextDecoder().decode(pdfOut.stderr).trim()
		throw new Error(`pdftotext failed for ${url} code ${pdfOut.code}: ${err}`)
	}
	return await Deno.readTextFile(destTxt)
}
