import { run } from 'util/proto.ts'
import Cmd from 'class/cmd.ts'
import { CmdCtx } from 'types'
import { Message } from 'wa'


export default class extends Cmd {
    constructor() {
        super({
            alias: ['r'],
            access: {
                restrict: true
            }
        })
    }

    async run({ bot, msg, args }: CmdCtx) {
        const code = args.join(' ')
        let statusMsg: Message
        
		const startTime = Date.now()
        const output = await run(code, sendOrEdit, 1_000)
        
        const duration = (Date.now() - startTime).duration(true)
        const RAM = Deno.memoryUsage().rss.bytes() // current RAM usage

        await sendOrEdit('`$ ' + duration + '/' + RAM + '`\n```' + output + '```')

        async function sendOrEdit(text: str) {
            // @ts-ignore Checking if the message was sent
            if (statusMsg?.rawData) await statusMsg.edit(text).catch(() => console.log('Failed to edit message'))
            else statusMsg = await bot.sendMessage(msg.to, text)
        }
        return
    }
}
