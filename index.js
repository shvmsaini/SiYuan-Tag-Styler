"use strict";

const siyuan = require("siyuan");

class TagStylerPlugin extends siyuan.Plugin {
    constructor(options) {
        super(options);
        this.styleElement = null;
        this.observer = null;
        this.settingsContainer = null;
    }

    async onload() {
        console.log("TagStylerPlugin onload");
        
        this.styleElement = document.createElement("style");
        this.styleElement.id = "siyuan-tag-styler";
        document.head.appendChild(this.styleElement);

        this.startObserver();

        try {
            const data = await this.loadData("config.json");
            if (!data) {
                this.data["config.json"] = this.getDefaultConfig();
            } else {
                this.data["config.json"] = Object.assign(this.getDefaultConfig(), data);
            }
        } catch (e) {
            this.data["config.json"] = this.getDefaultConfig();
        }
        
        this.updateStyles();
        this.initSettingUI();
    }

    getDefaultConfig() {
        return {
            global: {
                color: "#ffffff",
                bgColor: "#5a5a5a",
                shape: "pill",
                showHash: true,
                position: "normal"
            },
            tagStyles: []
        };
    }

    onunload() {
        if (this.styleElement) this.styleElement.remove();
        if (this.observer) this.observer.disconnect();
        if (this.checkTimer) clearInterval(this.checkTimer);
    }

    getSafeId(name) {
        if (!name) return "null";
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = ((hash << 5) - hash) + name.charCodeAt(i);
            hash |= 0;
        }
        return "ts-" + Math.abs(hash).toString(36);
    }

    processTags(element) {
        const root = element || document;
        const tags = root.querySelectorAll('span[data-type~="tag"]');
        tags.forEach((tag) => {
            const text = tag.innerText || tag.textContent || "";
            const tagName = text.trim().replace(/^#/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
            if (tagName && tag.getAttribute("data-tag-name") !== tagName) {
                tag.setAttribute("data-tag-name", tagName);
            }
        });

        const searchItems = root.querySelectorAll(".b3-list-item__text, .search__list .b3-list-item");
        const config = this.data["config.json"];
        if (config && config.tagStyles) {
            const sortedStyles = [...config.tagStyles].sort((a, b) => b.name.length - a.name.length);
            searchItems.forEach(item => {
                if (item.getAttribute("data-tag-styled")) return;
                let html = item.innerHTML;
                let placeholders = [];
                let changed = false;

                sortedStyles.forEach((style) => {
                    if (!style.name) return;
                    const safeId = this.getSafeId(style.name);
                    const escapedChars = style.name.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                    const pattern = escapedChars.join('(?:<mark>|<\/mark>)*');
                    const regex = new RegExp(`(#?${pattern})`, 'g');
                    html = html.replace(regex, (match) => {
                        if (match.includes('ts-stealth-pill')) return match;
                        changed = true;
                        const pId = `__TS_PH_${placeholders.length}__`;
                        const showHash = style.showHash !== false;
                        let finalContent = match;
                        if (showHash && !match.startsWith("#") && !match.startsWith("<mark>#")) {
                            finalContent = "#" + match;
                        } else if (!showHash) {
                            finalContent = match.replace(/^#/, '').replace(/^<mark>#/, '<mark>');
                        }
                        placeholders.push({ id: pId, content: `<span class="ts-stealth-pill ${safeId}">${finalContent}</span>` });
                        return pId;
                    });
                });

                const globalRegex = /(#[\w/]+)(?![^<]*>)/g;
                html = html.replace(globalRegex, (match) => {
                    if (match.includes('__TS_PH_') || match.includes('ts-stealth-pill')) return match;
                    changed = true;
                    const pId = `__TS_PH_${placeholders.length}__`;
                    const showHash = config.global.showHash !== false;
                    let finalContent = showHash ? match : match.replace(/^#/, '');
                    placeholders.push({ id: pId, content: `<span class="ts-stealth-pill ts-global-pill">${finalContent}</span>` });
                    return pId;
                });

                if (changed) {
                    placeholders.forEach(p => { html = html.split(p.id).join(p.content); });
                    item.innerHTML = html;
                    item.setAttribute("data-tag-styled", "true");
                }
            });
        }
    }

    startObserver() {
        this.processTags(document);
        this.observer = new MutationObserver(() => this.processTags(document));
        this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        this.checkTimer = setInterval(() => this.processTags(document), 2000);
    }

    updateStyles() {
        const config = this.data["config.json"];
        const g = config.global || this.getDefaultConfig().global;
        let css = `
            span[data-type~="tag"], .ts-stealth-pill, .ts-global-pill {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: ${g.shape === "pill" ? "20px" : "4px"} !important;
                padding: 1px 12px !important;
                margin: 0 2px !important;
                border: none !important;
                font-size: 0.9em !important;
                font-weight: 500 !important;
                line-height: 1.4 !important;
                vertical-align: middle !important;
                box-shadow: 0 1px 2px rgba(0,0,0,0.15) !important;
                background-color: ${g.bgColor} !important;
                color: ${g.color} !important;
            }
            ${g.position === "end" ? `span[data-type~="tag"] { float: right !important; margin-left: 8px !important; } [data-node-id]:has(span[data-type~="tag"])::after { content: ""; display: table; clear: both; }` : ""}
            .ts-stealth-pill mark { background-color: rgba(255, 255, 0, 0.4) !important; color: inherit !important; padding: 0 !important; }
            ${g.showHash ? `span[data-type~="tag"]::before { content: "#"; margin-right: 2px; opacity: 0.7; }` : ""}
        `;
        if (config.tagStyles) {
            config.tagStyles.forEach((style) => {
                if (!style.name) return;
                const safeId = this.getSafeId(style.name);
                const selector = `span[data-type~="tag"][data-tag-name="${style.name}"], .${safeId}`;
                css += `
${selector} {
    color: ${style.color || "#ffffff"} !important;
    background-color: ${style.bgColor || "var(--b3-theme-primary)"} !important;
    border-radius: ${style.shape === "pill" ? "20px" : (style.radius || "4px")} !important;
}
${style.showHash === false ? `span[data-type~="tag"][data-tag-name="${style.name}"]::before { content: "" !important; display: none !important; }` : (style.showHash === true ? `span[data-type~="tag"][data-tag-name="${style.name}"]::before { content: "#" !important; margin-right: 2px !important; opacity: 0.8 !important; display: inline-block !important; }` : "")}
${style.position === "end" ? `span[data-type~="tag"][data-tag-name="${style.name}"] { float: right !important; margin-left: 8px !important; } [data-node-id]:has(span[data-tag-name="${style.name}"])::after { content: ""; display: table; clear: both; }` : (style.position === "normal" ? `span[data-type~="tag"][data-tag-name="${style.name}"] { float: none !important; margin-left: 4px !important; }` : "")}
`;
            });
        }
        if (this.styleElement) this.styleElement.textContent = css;
    }

    initSettingUI() {
        this.setting = new siyuan.Setting({ confirmCallback: () => { this.saveData("config.json", this.data["config.json"]); this.updateStyles(); } });
        this.settingsContainer = document.createElement("div");
        this.settingsContainer.className = "fn__flex-column";
        this.settingsContainer.style.width = "100%";
        this.settingsContainer.style.padding = "0";
        this.setting.addItem({ title: "", description: "", actionElement: this.settingsContainer });
    }

    openSetting() { this.renderSettingsList(); this.setting.open("Tag Styler Settings"); }

    renderSettingsList() {
        this.settingsContainer.innerHTML = "";
        const config = this.data["config.json"];
        const globalCard = document.createElement("div");
        globalCard.className = "b3-label fn__flex-column";
        globalCard.style.padding = "16px"; globalCard.style.border = "1px solid var(--b3-theme-primary-light)"; globalCard.style.borderRadius = "12px"; globalCard.style.backgroundColor = "var(--b3-theme-surface-lighter)"; globalCard.style.gap = "12px"; globalCard.style.marginBottom = "10px";
        globalCard.innerHTML = `
            <div class="fn__flex" style="align-items: center; gap: 8px;"><svg style="width: 16px; height: 16px; color: var(--b3-theme-primary);"><use xlink:href="#iconSettings"></use></svg><span style="font-weight: 700; color: var(--b3-theme-primary);">Global Defaults</span></div>
            <div class="fn__flex" style="gap: 15px; flex-wrap: wrap; align-items: flex-end;">
                <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.75em; opacity: 0.7;">Default Colors</label><div class="fn__flex" style="gap: 6px;"><input class="b3-input" type="color" value="${config.global.color}" data-key="color" data-target="global" style="width: 40px; height: 32px;"><input class="b3-input" type="color" value="${config.global.bgColor}" data-key="bgColor" data-target="global" style="width: 40px; height: 32px;"></div></div>
                <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.75em; opacity: 0.7;">Shape</label><select class="b3-select" data-key="shape" data-target="global" style="width: 90px;"><option value="pill" ${config.global.shape === "pill" ? "selected" : ""}>Pill</option><option value="rounded" ${config.global.shape === "rounded" ? "selected" : ""}>Rounded</option></select></div>
                <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.75em; opacity: 0.7;">Pos</label><select class="b3-select" data-key="position" data-target="global" style="width: 95px;"><option value="normal" ${config.global.position === "normal" ? "selected" : ""}>Inline</option><option value="end" ${config.global.position === "end" ? "selected" : ""}>Float End</option></select></div>
                <label class="fn__flex" style="align-items: center; gap: 8px; cursor: pointer; padding-bottom: 6px;"><input type="checkbox" class="b3-switch" data-key="showHash" data-target="global" ${config.global.showHash ? "checked" : ""}> <span style="font-size: 0.85em;">Show #</span></label>
            </div>
        `;
        globalCard.querySelectorAll("input, select").forEach(el => { el.addEventListener(el.type === "checkbox" ? "change" : "input", (e) => { const val = e.target.type === "checkbox" ? e.target.checked : e.target.value; config.global[e.target.getAttribute("data-key")] = val; }); });
        this.settingsContainer.appendChild(globalCard);
        const listContainer = document.createElement("div");
        listContainer.className = "fn__flex-column"; listContainer.style.gap = "8px";
        this.settingsContainer.appendChild(listContainer);
        config.tagStyles.forEach((style, index) => {
            const card = document.createElement("div");
            card.className = "b3-label fn__flex-column";
            card.style.padding = "12px"; card.style.border = "1px solid var(--b3-border-color)"; card.style.borderRadius = "10px"; card.style.backgroundColor = "var(--b3-theme-surface)"; card.style.gap = "10px";
            card.innerHTML = `
                <div class="fn__flex" style="align-items: center; justify-content: space-between;"><input class="b3-input" value="${style.name}" placeholder="Tag Name" style="width: 160px; font-weight: 600;" data-key="name"><div class="fn__flex" style="gap: 8px;"><div class="tag-preview" style="padding: 2px 12px; border-radius: ${style.shape === "pill" ? "20px" : "4px"}; background-color: ${style.bgColor}; color: ${style.color}; font-weight: 600; font-size: 0.85em; display: flex; align-items: center;">${style.showHash !== false ? "#" : ""}${style.name}</div><button class="b3-button b3-button--cancel delete-btn" style="padding: 4px 8px;"><svg style="width: 12px; height: 12px;"><use xlink:href="#iconTrashcan"></use></svg></button></div></div>
                <div class="fn__flex" style="gap: 12px; flex-wrap: wrap; align-items: flex-end;">
                    <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.7em; opacity: 0.6;">Colors</label><div class="fn__flex" style="gap: 6px;"><input class="b3-input" type="color" value="${style.color || "#ffffff"}" data-key="color" style="width: 35px; height: 30px;"><input class="b3-input" type="color" value="${style.bgColor || "#3b82f6"}" data-key="bgColor" style="width: 35px; height: 30px;"></div></div>
                    <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.7em; opacity: 0.6;">Shape</label><select class="b3-select" data-key="shape" style="width: 85px;"><option value="pill" ${style.shape === "pill" ? "selected" : ""}>Pill</option><option value="rounded" ${style.shape === "rounded" ? "selected" : ""}>Rounded</option></select></div>
                    <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.7em; opacity: 0.6;">Pos</label><select class="b3-select" data-key="position" style="width: 95px;"><option value="normal" ${style.position === "normal" ? "selected" : ""}>Inline</option><option value="end" ${style.position === "end" ? "selected" : ""}>Float End</option></select></div>
                    <label class="fn__flex" style="align-items: center; gap: 4px; cursor: pointer; padding-bottom: 6px;"><input type="checkbox" class="b3-switch" data-key="showHash" ${style.showHash !== false ? "checked" : ""}> <span style="font-size: 0.8em; opacity: 0.8;">#</span></label>
                </div>`;
            const preview = card.querySelector(".tag-preview");
            card.querySelectorAll("input, select").forEach((input) => { input.addEventListener(input.type === "checkbox" ? "change" : "input", (e) => { const key = e.target.getAttribute("data-key"); style[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value; if (key === "name" || key === "showHash") preview.textContent = (style.showHash !== false ? "#" : "") + style.name; if (key === "color") preview.style.color = style.color; if (key === "bgColor") preview.style.backgroundColor = style.bgColor; if (key === "shape") preview.style.borderRadius = style.shape === "pill" ? "20px" : "4px"; }); });
            card.querySelector(".delete-btn").onclick = () => { config.tagStyles.splice(index, 1); this.renderSettingsList(); };
            listContainer.appendChild(card);
        });
        const addBtn = document.createElement("button");
        addBtn.className = "b3-button b3-button--text fn__block"; addBtn.style.padding = "10px"; addBtn.style.border = "2px dashed var(--b3-border-color)"; addBtn.style.marginTop = "5px";
        addBtn.innerHTML = `<svg style="width: 14px; height: 14px; margin-right: 8px; vertical-align: middle;"><use xlink:href="#iconAdd"></use></svg>Add Tag Customization`;
        addBtn.onclick = () => { config.tagStyles.push({ name: "new-tag", color: "#ffffff", bgColor: "#3b82f6", shape: "pill", radius: "4px", position: "normal", showHash: true }); this.renderSettingsList(); };
        this.settingsContainer.appendChild(addBtn);
    }
}
module.exports = TagStylerPlugin;
