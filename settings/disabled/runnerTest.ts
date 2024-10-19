// const data = await fetch('http://localhost:3077/languages')

import { readFileSync } from 'node:fs'

// console.log(await data.json())
const value = {
	img: readFileSync('test/image.png'),
	quality: 1,
}
const data = await fetch('http://localhost:3077/remover', {
	method: 'POST',
	body: JSON.stringify(value),
	headers: {
		'Content-Type': 'application/json',
	},
})

console.log(await data.json())
