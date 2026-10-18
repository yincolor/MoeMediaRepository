
class PosterCard extends HTMLElement{
    static observedAttributes = ['img-url', 'title'];
    #titleResizeObserver;

    constructor(){
        super();
        const shadow = this.attachShadow({mode:"open"});
        shadow.appendChild(this.#generateShadowDom());
        this.#titleResizeObserver = null;
        this.#setStyle();
    }

    attributeChangedCallback(name, oldValue,newValue){
        // console.log(`海报卡片，属性 ${name} 已由 ${oldValue} 变更为 ${newValue}。`);
        if(name === 'img-url'){
            this.#setStyle();
        } else if(name === 'title'){
            this.#syncTitleText();
        }
    }

    connectedCallback(){
        this.#updateTitleOverflow();
        this.#startTitleObserver();
    }

    disconnectedCallback(){
        this.#stopTitleObserver();
    }

    /**
     * 创建shadow内容
     */
    #generateShadowDom(){
        // console.log("创建 PosterCard 内部组件");
        const _root = document.createElement('div');
        _root.classList.add('card');
        const poster = document.createElement('div');
        poster.classList.add('poster');
        const titleArea = document.createElement('div');
        titleArea.classList.add('title');
        const titleTrack = document.createElement('div');
        titleTrack.classList.add('title-track');
        const titleText = document.createElement('span');
        titleText.classList.add('title-text');
        titleText.textContent = this.getAttribute('title') || "测试文本";
        titleTrack.appendChild(titleText);
        titleArea.appendChild(titleTrack);
        _root.append(poster, titleArea);
        return _root;
    }

    #titleEl(){
        return this.shadowRoot && this.shadowRoot.querySelector('.title');
    }

    #titleTrack(){
        return this.shadowRoot && this.shadowRoot.querySelector('.title-track');
    }

    #getTitleText(){
        return this.getAttribute('title') || "测试文本";
    }

    /**
     * 把 title 属性同步到标题轨道中（只保留一份文本，多余的副本删除）
     */
    #syncTitleText(){
        const track = this.#titleTrack();
        if(!track) return;

        const texts = Array.from(track.querySelectorAll('.title-text'));
        for(let i = texts.length - 1; i >= 1; i--){
            texts[i].remove();
        }
        if(texts.length > 0){
            texts[0].textContent = this.#getTitleText();
        } else {
            const span = document.createElement('span');
            span.classList.add('title-text');
            span.textContent = this.#getTitleText();
            track.appendChild(span);
        }

        this.#updateTitleOverflow();
    }

    /**
     * 标题溢出检测：
     *  - 溢出：复制一份相同文本（两份并排），通过 -50% 位移实现无缝跑马灯
     *  - 未溢出：只保留一份文本，恢复居中显示
     */
    #updateTitleOverflow(){
        const title = this.#titleEl();
        const track = this.#titleTrack();
        if(!title || !track) return;

        const overflow = track.scrollWidth > title.clientWidth;
        const texts = track.querySelectorAll('.title-text');
        const copies = texts.length;

        if(overflow && copies < 2){
            const first = texts[0];
            if(first){
                track.appendChild(first.cloneNode(true));
            }
            title.classList.add('marquee');
        } else if(!overflow && copies > 1){
            for(let i = copies - 1; i >= 1; i--){
                texts[i].remove();
            }
            title.classList.remove('marquee');
        } else if(overflow){
            title.classList.add('marquee');
        } else {
            title.classList.remove('marquee');
        }
    }

    #startTitleObserver(){
        const title = this.#titleEl();
        const track = this.#titleTrack();
        if(!title || !track || this.#titleResizeObserver) return;

        this.#titleResizeObserver = new ResizeObserver(() => {
            this.#updateTitleOverflow();
        });
        this.#titleResizeObserver.observe(title);
        this.#titleResizeObserver.observe(track);
    }

    #stopTitleObserver(){
        if(this.#titleResizeObserver){
            this.#titleResizeObserver.disconnect();
            this.#titleResizeObserver = null;
        }
    }

    #setStyle(){
        const imgUrl = this.getAttribute('img-url') || '../img/default.png';
        const baseStyle = `
            :host{
                display: flex;
                width: var(--card-width);
                box-sizing:border-box;
            }
            .card{
                flex: 1 0 auto;
                display: inline-flex;
                flex-direction: column;
                width: 100%;
                gap: 0px;
                background: #000;
            }
            .poster{
                width: 100%;
                aspect-ratio: 466 / 621;
                background-image: url("${imgUrl}");
                background-size: cover;
                background-position: center;
                background-repeat: no-repeat;
            }
            .title{
                width: 100%;
                height: var(--card-title-area-height);
                background-color: var(--card-title-area-bg-color);
                color: var(--card-title-area-color);
                font-size: var(--card-title-font-size);
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                white-space: nowrap;
                position: relative;
            }
            .title-track{
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                width: max-content;
                height: 100%;
                white-space: nowrap;
                will-change: transform;
            }
            .title-text{
                display: inline-block;
                flex: 0 0 auto;
                white-space: nowrap;
            }
            .title.marquee{
                justify-content: flex-start;
            }
            .title.marquee .title-track{
                animation: title-marquee 8s linear infinite;
            }
            @keyframes title-marquee{
                0%{
                    transform: translateX(0);
                }
                100%{
                    transform: translateX(-50%);
                }
            }
        `;
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(baseStyle);
        this.shadowRoot.adoptedStyleSheets = [sheet];
    }

}

customElements.define("poster-card", PosterCard);
