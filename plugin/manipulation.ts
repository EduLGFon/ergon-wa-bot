// importa a lib de imagem
import { Buffer } from 'node:buffer'
import { Image } from 'imageScript'

export { crop }
async function crop(input: Buffer<ArrayBuffer>) {
	// lê a imagem de um arquivo (ou pode vir de um fetch, buffer, etc.)
	const image = await Image.decode(input)

	// calcula o menor lado pra garantir o quadrado
	const size = Math.min(image.width, image.height)

	// calcula o ponto de início pra centralizar
	const x = Math.floor((image.width - size) / 2)
	const y = Math.floor((image.height - size) / 2)

	// cropa essa porra
	const cropped = image.crop(x, y, size, size)

	return await cropped.encode(3)
}
