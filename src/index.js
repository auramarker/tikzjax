import { Worker, spawn, Thread } from 'threads';
import '../css/container.css';

// document.currentScript polyfill
if (document.currentScript === undefined) {
    const scripts = document.getElementsByTagName('script');
    document.currentScript = scripts[scripts.length - 1];
}

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

class ElementTikjax extends HTMLElement {
    static get observedAttributes() {
        return ['code', 'tikid'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // 初始化属性的内部值
        this._code = '';
        this._tikId = '';
        this._rendering = false;
        this._html = '';

        // 创建样式元素
        const style = document.createElement('style');
        style.textContent = `
            :host {
                display: block;
                width: 100%;
                height: 100%;
            }
        `;
        this.shadowRoot.appendChild(style);

        // 创建用于内容的 div
        this.contentDiv = document.createElement('div');
        this.shadowRoot.appendChild(this.contentDiv);
    }

    // 定义属性的 getter 和 setter，以实现响应式
    get code() {
        return this._code;
    }

    set code(value) {
        const oldValue = this._code;
        if (oldValue !== value) {
            this._code = value;
            // 当 code 改变时，重新渲染 TikZ
            this.renderTikz();
        }
    }

    get tikId() {
        return this._tikId;
    }

    set tikId(value) {
        const oldValue = this._tikId;
        if (oldValue !== value) {
            this._tikId = value;
            this.contentDiv.id = this._tikId; // 更新 contentDiv 的 ID
        }
    }

    get rendering() {
        return this._rendering;
    }

    set rendering(value) {
        const oldValue = this._rendering;
        if (oldValue !== value) {
            this._rendering = value;
            this.render(); // 当 rendering 状态改变时，重新渲染
        }
    }

    get html() {
        return this._html;
    }

    set html(value) {
        const oldValue = this._html;
        if (oldValue !== value) {
            this._html = value;
            this.render(); // 当 html 改变时，重新渲染
        }
    }

    connectedCallback() {
        if (!this.tikId) {
            this.tikId = 'tikz' + Math.floor(Math.random() * 1000000);
        }
        this.code = this.textContent;
        // 初始化渲染
        this.renderTikz();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            switch (name) {
                case 'code':
                    this.code = newValue;
                    break;
                case 'tikid':
                    this.tikId = newValue;
                    break;
            }
        }
    }

    render() {
        if (this.rendering) {
            this.contentDiv.textContent = 'Rendering...';
            this.contentDiv.removeAttribute('class'); // 移除可能的 tikzjax-content 类
        } else {
            this.contentDiv.innerHTML = this.html; // 使用 innerHTML 插入渲染后的 HTML
            this.contentDiv.className = 'tikzjax-content'; // 添加类名
            this.contentDiv.id = this.tikId; // 确保 ID 正确
        }
    }

    async renderTikz() {
        if (this.rendering) return;

        this.dispatchEvent(
            new CustomEvent('tikzjax-render-start', {
                bubbles: true,
                composed: true,
                detail: {
                    tikId: this.tikId
                }
            })
        );
        this.rendering = true;

        try {
            const tikzSource = this.tidyTikzSource(this.code);
            console.log(tikzSource);
            const start = Date.now();
            this.html = await (
                await texWorker
            ).texify(tikzSource, {
                texPackages: '{"chemfig": ""}',
                showConsole: true
            });
            this.dispatchEvent(
                new CustomEvent('tikzjax-render-complete', {
                    bubbles: true,
                    composed: true,
                    detail: { tikId: this.tikId, cost: Date.now() - start }
                })
            );
        } catch (e) {
            console.error(e);
            this.dispatchEvent(
                new CustomEvent('tikzjax-render-error', {
                    bubbles: true,
                    composed: true,
                    detail: { tikId: this.tikId, error: e }
                })
            );
        } finally {
            this.rendering = false;
        }
    }

    /**
     * 简化 TikZ 代码
     * @param tikzSource
     * @returns {string}
     */
    tidyTikzSource(tikzSource) {
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
}

customElements.define('element-tikjax', ElementTikjax);
