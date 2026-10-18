

class TextButton extends HTMLElement{
    static observedAttributes = ['selected']; 
    constructor(){
        super();
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`
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
                border-radius: var(--border-radius); 
                font-size: var(--font-size); 
                padding: var(--padding); 
            }
            .btn:hover{
                background-color: var(--btn-hover-bg-color);
            }
            :host([selected]) .btn{
                background-color: var(--btn-selected-bg-color);
            }
        `); 
        const shadow = this.attachShadow({mode:"open"});
        shadow.adoptedStyleSheets = [sheet]; 
        shadow.appendChild(this.#generateShadowDom());

    }

    attributeChangedCallback(name, oldValue,newValue){
        // console.log(`文本按钮，属性 ${name} 已由 ${oldValue} 变更为 ${newValue}。`);
        if(name === 'selected'){

        }
    }

    connectedCallback(){ 
        // console.log("MyButton 组件已挂载"); 
    }
    
    disconnectedCallback(){
        // console.log("MyButton 组件已卸载"); 
    }

    /**
     * 创建shadow内容
     */
    #generateShadowDom(){
        console.log("创建 MyButton 内部组件"); 
        const _root = document.createElement('div');
        _root.classList.add('btn');
        
        const _solt = document.createElement('slot');
        const btn_content = document.createElement('div');
        btn_content.append(_solt)
        _root.appendChild(btn_content);
        return _root;
    }

    // #setStyle(){
    //     const baseStyle = `
    //         :host{
    //             display: inline-block;
    //             box-sizing:border-box;
    //             vertical-align:middle;
    //         }
    //         .btn{
    //             width: auto;
    //             height: auto;
    //             display: inline-flex;
    //             justify-content: center; 
    //             align-items: center;
    //             border-radius: var(--border-radius); 
    //             font-size: var(--font-size); 
    //             padding: var(--padding); 
    //         }
    //         .btn:hover{ 
    //             background-color: var(--btn-hover-bg-color);
    //         }
    //     `;
    //     const selectedType = this.getAttribute('selected') || false;
    //     let selectedStyle = '';
    //     if(selectedType){
    //         selectedStyle = 
    //     }

    // }
}

customElements.define("text-btn", TextButton); 