

class IconButton extends HTMLElement{

    static observedAttributes = ['icon-name', 'icon-size', 'layout-type']
    constructor(){
        super();
        const shadow = this.attachShadow({mode:"open"});
        shadow.appendChild(this.#generateShadowDom());

    }

    attributeChangedCallback(name, oldValue, newValue) {
        console.log(`属性 ${name} 已由 ${oldValue} 变更为 ${newValue}。`);
        if(name === 'icon-name'){
            this.#setIcon();
            return;
        }
        if(['icon-size', 'layout-type'].includes(name)){
            this.#setStyle();
            return;
        }
    }

    connectedCallback(){ 
        console.log("Icon-Button 组件已挂载"); 
        this.#setIcon();
        this.#setStyle(); 
    }
    
    disconnectedCallback(){
        console.log("Icon-Button 组件已卸载"); 
    }

    /**
     * 创建shadow内容
     */
    #generateShadowDom(){
        console.log("创建 MyButton 内部组件"); 
        const shadowRootElement = document.createElement('div');
        shadowRootElement.classList.add('btn');

        const iconDiv = document.createElement("div");
        iconDiv.classList.add('icon');

        const titleDiv = document.createElement('div');
        titleDiv.classList.add('title');

        const soltElement = document.createElement('slot');

        titleDiv.appendChild(soltElement);
        shadowRootElement.append(iconDiv, titleDiv);

        return shadowRootElement;
    }

    #setIcon(){
        console.log(`设置图标`);
        
        /** @type {HTMLDivElement} */
        const icon = this.shadowRoot.querySelector('.icon')
        if(icon){
            const iconName = this.getAttribute('icon-name') || "default";
            icon.style.backgroundImage = `url("../img/icon/${iconName}.svg")`; 
        }else{
            console.log(`icon元素丢失`);
            
        }
    }
    #setStyle(){
        const layoutType = this.getAttribute('layout-type') || 'IconLeftTextRight'; /* IconLeftTextRight, IconTopTextBottom, IconOnly, TextOnly */
        const iconSize = this.getAttribute('icon-size') || '1.5em'; /* 20px, 1em ... */
        const baseStyle = `
            :host{
                display: inline-block;
                box-sizing:border-box;
                vertical-align:middle;
            }
            .btn{
                width: auto;
                height: auto;

                display: inline-flex;
                justify-content: center; 
                align-items: center;

                padding: var(--padding);
                gap: var(--gap);

                border-radius: var(--border-radius); 
                font-size: var(--font-size); 
                user-select: none;
            }
            .btn:hover{
                background-color: var(--btn-hover-bg-color);
            }
            .icon{
                flex: 0 0 auto; 
                width: ${iconSize};
                aspect-ratio: 1 / 1;
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
            }
            .title{
                display: flex;
                aligin-item: center;
                white-space: nowrap;
            }
        `;

        let layoutStyle = '';
        switch (layoutType) {
            case 'IconTopTextBottom': /* 图标在上，文本在下 */
                layoutStyle = `
                    .btn{
                        flex-direction: column;
                    }
                    .title{
                        diaplay:flex;
                    }
                `;
                break;
            
            case 'IconOnly': /* 只显示图标 */
                layoutStyle = `
                    .btn {
                        padding: var(--padding);
                    }
                    .title {
                        diaplay:none;
                    }
                `;
                break; 
            case 'TextOnly':  /* 只显示文本 */
                layoutStyle = `
                    .icon {
                        diaplay:none;
                    }
                `;
                break; 
            
            case 'IconLeftTextRight': /* 图标在左，文本在右 */
            default:
                layoutStyle = `
                    .btn {
                        flex-direction: row;
                    }
                `;
                break;
        }
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(baseStyle + layoutStyle);
        this.shadowRoot.adoptedStyleSheets = [sheet]; 
    }
}

customElements.define("icon-btn", IconButton); 