import { BroadcastChannel, isMainThread, threadId } from 'node:worker_threads';

const bc = new BroadcastChannel('workers') as bc;
bc.onMsg = (msg: workerMsg) => print(msg.data);

export default bc;

export { print };
export type { bc, workerMsg };

interface bc extends BroadcastChannel {
	onMsg(msg: workerMsg): void;
	send(obj: any): void;
}

interface workerMsg {
	thread: num;
	target: 'run' | 'main';
	data: any;
}

bc.send = (obj: any) => {
	obj.thread = threadId;

	bc.postMessage(JSON.stringify(obj));
};

bc.onmessage = async (event) => {
	const { data, type } = event as { type: 'message'; data: str };

	if (type !== 'message') return print(event);
	const msg = JSON.parse(data);

	bc.onMsg(msg);
};

function print(...args: any) {
	const title = isMainThread ? 'MAIN' : `WORKER #${threadId}`;

	console.log(`${title}:`, ...args);
}
