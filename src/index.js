import { spawn, Thread, Worker } from 'threads';
import SVGO from './svgo.browser';
import '../css/container.css';

// Determine where this script was loaded from. This is used to find the files to load.
const url = new URL(document.currentScript.src);

let texWorker;

const initializeWorker = async () => {
    const urlRoot = url.href.replace(/\/tikzjax\.js(?:\?.*)?$/, '');

    // Set up the worker thread.
    const tex = await spawn(new Worker(`${urlRoot}/run-tex.js`));
    Thread.events(tex).subscribe((e) => {
        if (e.type === 'message' && typeof e.data === 'string') console.log(e.data);
    });

    // Load the assembly and core dump.
    try {
        await tex.load(urlRoot);
    } catch (err) {
        console.log(err);
    }

    return tex;
};

const shutdown = async () => {
    await Thread.terminate(await texWorker);
};

if (!window.TikzJax) {
    window.TikzJax = true;

    texWorker = initializeWorker();

    // Stop the mutation observer and close the thread when the window is closed.
    window.addEventListener('unload', shutdown);
}

async function renderTexToSvg(source, enableCache = false) {
    // const svg = await getSvgFromCache(source);
    // if (svg) return svg;

    texWorker = await texWorker;
    // if (enableCache) {
    //     await setSvgToCache(source, svgData);
    // }
    return await texWorker.texify(
        source,
        {
            texPackages: '{"chemfig": ""}',
            showConsole: true
        },
        false
    );
}

/**
 * 简化 TikZ 代码
 * @param tikzSource
 * @returns {string}
 */
function tidyTikzSource(tikzSource) {
    // 移除不标准的空格
    const remove = '&nbsp;';
    tikzSource = tikzSource.replaceAll(remove, '');

    let lines = tikzSource.split('\n');

    // Trim 每一行
    lines = lines.map((line) => line.trim());

    // 删除空行
    lines = lines.filter((line) => line);

    return lines.join('\n');
}

// 队列维护生成svg，一次执行一个
function Queue() {}

Queue.prototype = {
    constructor: Queue,
    runing: false,
    queue: [],
    enqueue(tikzSource, resolve, reject, enableCache = false) {
        this.queue.push({ tikzSource, resolve, reject, enableCache });
        if (this.queue.length > 0) {
            this.processQueue();
        }
    },
    async processQueue() {
        if (this.runing) return; // 如果正在处理队列，则不再处理
        this.runing = true;
        while (this.queue.length > 0) {
            const { tikzSource, resolve, reject, enableCache } = this.queue.shift();
            try {
                const svg = await renderTexToSvg(tikzSource, enableCache);
                console.log('TikZ to SVG conversion completed.', svg.length);
                // 优化 SVG
                const optimizedSvg = await SVGO.optimize(svg);
                console.log('SVG optimization completed.', optimizedSvg.data.length);
                resolve(optimizedSvg.data);
            } catch (error) {
                reject(error);
            }
        }
        this.runing = false; // 处理完队列后，设置为未运行状态
    }
};

const tikzQueue = new Queue();

window.tikzToSvg = (tikzSource, enableCache = false) => {
    const { resolve, reject, promise } = Promise.withResolvers();
    tikzQueue.enqueue(tidyTikzSource(tikzSource), resolve, reject, enableCache);
    return promise;
};
