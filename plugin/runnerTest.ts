// const data = await fetch('http://localhost:8080/languages')

// console.log(await data.json())
const value = {
    // lang: 'lua',
    // code: 'print("hell world!")',
    file: 'settings/temp/exec.lua',
}

const data = await fetch('http://localhost:8080/run', {
    method: 'POST',
    body: JSON.stringify(value),
})

console.log(await data.text())
