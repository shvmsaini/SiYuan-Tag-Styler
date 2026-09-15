"use strict";

const siyuan = require("siyuan");

class TagStylerPlugin extends siyuan.Plugin {
    constructor(options) {
        super(options);
        this.styleElement = null;
        this.observer = null;
        this.settingsContainer = null;
        this.processRAF = null;
        this.checkTimer = null;
    }

    async onload() {
        console.log("TagStylerPlugin onload");

        this.styleElement = document.createElement("style");
        this.styleElement.id = "siyuan-tag-styler";
        document.head.appendChild(this.styleElement);

        this.data["config.json"] = this.getDefaultConfig();
        try {
            const data = await this.loadData("config.json");
            if (data) {
                this.data["config.json"] = Object.assign(this.getDefaultConfig(), data);
            }
        } catch (e) {
            console.error("Failed to load TagStyler configuration", e);
        }

        this.updateStyles();
        this.initSettingUI();
        this.startObserver();
    }

    getDefaultConfig() {
        return {
            global: {
                color: "#ffffff",
                colorAlpha: 100,
                bgColor: "#5a5a5a",
                bgColorAlpha: 100,
                fontSizeMultiplier: 100,
                shape: "pill",
                showHash: true,
                position: "normal"
            },
            tagStyles: []
        };
    }

    hexToRgba(hex, alpha) {
        if (!hex || typeof hex !== "string") return hex;
        const cleaned = hex.replace("#", "");
        let r, g, b;
        if (cleaned.length === 3) {
            r = parseInt(cleaned[0] + cleaned[0], 16);
            g = parseInt(cleaned[1] + cleaned[1], 16);
            b = parseInt(cleaned[2] + cleaned[2], 16);
        } else {
            r = parseInt(cleaned.substring(0, 2), 16);
            g = parseInt(cleaned.substring(2, 4), 16);
            b = parseInt(cleaned.substring(4, 6), 16);
        }
        const a = (typeof alpha === "number" ? alpha : 100) / 100;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    onunload() {
        if (this.checkTimer) clearInterval(this.checkTimer);
        if (this.processRAF) {
            cancelAnimationFrame(this.processRAF);
            this.processRAF = null;
        }
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.styleElement) {
            this.styleElement.remove();
            this.styleElement = null;
        }
    }

    async uninstall() {
        await this.removeData("config.json");
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
        const config = this.data["config.json"];
        if (!config) return;

        // 1. Process explicit tag nodes in editor, outline panel, and docks
        const tags = root.querySelectorAll('span[data-type~="tag"]');
        tags.forEach((tag) => {
            if (tag.closest('.av__cell')) return; // Skip database elements here
            const text = tag.textContent || "";
            const tagName = text.trim().replace(/^#/, "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
            if (tagName && tag.getAttribute("data-tag-name") !== tagName) {
                tag.setAttribute("data-tag-name", tagName);
            }
        });

        // 2. Process search results plain-text tags
        const searchItems = root.querySelectorAll(".search__list .b3-list-item__text, .search__list .b3-list-item, [data-type='search'] .b3-list-item__text");
        if (searchItems.length > 0 && config.tagStyles) {
            const sortedStyles = [...config.tagStyles].sort((a, b) => b.name.length - a.name.length);
            searchItems.forEach(item => {
                if (item.getAttribute("data-tag-styled")) return;
                if (item.querySelector('span[data-type~="tag"]')) return;
                let html = item.innerHTML;
                let changed = false;

                sortedStyles.forEach((style) => {
                    if (!style.name) return;
                    const cleanName = style.name.replace(/[​-‍⁠﻿]/g, "").trim();
                    if (!cleanName) return;
                    const safeId = this.getSafeId(cleanName);
                    const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    // HTML-safe regex: match tag only when not inside HTML tags/attributes
                    const regex = new RegExp(`(?<![\\w/])(#?${escaped})(?![\\w/])(?![^<]*>)`, 'g');

                    if (regex.test(html)) {
                        html = html.replace(regex, (match) => {
                            if (match.includes('ts-stealth-pill')) return match;
                            changed = true;
                            const showHash = style.showHash !== false;
                            let cleanText = match.replace(/^#/, '');
                            return `<span class="ts-stealth-pill ${safeId}">${showHash ? '#' : ''}${cleanText}</span>`;
                        });
                    }
                });

                if (changed) {
                    item.innerHTML = html;
                    item.setAttribute("data-tag-styled", "true");
                }
            });
        }

        // 3. SPECIAL FIX: Process plain-text tags inside database attribute views (.av__cell)
        const dbCells = root.querySelectorAll(".av__cell");
        if (dbCells.length > 0) {
            dbCells.forEach(cell => {
                // Find all text nodes or links inside the cell that contain # tags
                const targets = cell.querySelectorAll(".av__cell-text, a, span");
                const elementsToProcess = targets.length > 0 ? Array.from(targets) : [cell];

                elementsToProcess.forEach(el => {
                    if (el.children.length > 0 && el.tagName.toLowerCase() !== 'a') return; // Only target text containers
                    let html = el.innerHTML;

                    // Regex matches words surrounded by hashes, e.g., #Graph# or #dp#
                    const dbTagRegex = /#([A-Za-z0-9_\-\/]+)#/g;

                    if (dbTagRegex.test(html)) {
                        let changed = false;
                        html = html.replace(dbTagRegex, (match, tagName) => {
                            changed = true;
                            const cleanTagName = tagName.replace(/[​-‍⁠﻿]/g, "").trim();
                            // Check if there's a custom configuration rule for this tag name
                            const matchedStyle = config.tagStyles.find(s => s.name.replace(/[​-‍⁠﻿]/g, "").trim() === cleanTagName);
                            const safeId = matchedStyle ? this.getSafeId(cleanTagName) : "ts-global-pill";
                            const showHash = matchedStyle ? (matchedStyle.showHash !== false) : (config.global.showHash !== false);

                            return `<span class="ts-db-pill ${safeId}" data-tag-name="${cleanTagName}">${showHash ? '#' : ''}${cleanTagName}</span>`;
                        });

                        if (changed) {
                            el.innerHTML = html;
                        }
                    }
                });
            });
        }
    }

    startObserver() {
        this.processTags(document);

        this.observer = new MutationObserver(() => {
            if (this.processRAF) return;
            this.processRAF = requestAnimationFrame(() => {
                this.processRAF = null;
                if (this.observer) this.observer.disconnect();

                this.processTags(document);

                if (this.observer) {
                    this.observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                        characterData: true
                    });
                }
            });
        });

        this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });

        this.checkTimer = setInterval(() => {
            if (this.processRAF) return;
            this.processRAF = requestAnimationFrame(() => {
                this.processRAF = null;
                if (this.observer) this.observer.disconnect();
                this.processTags(document);
                if (this.observer) {
                    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
                }
            });
        }, 2000);
    }

    updateStyles() {
        const config = this.data["config.json"];
        const g = config.global || this.getDefaultConfig().global;

        let css = `
            span[data-type~="tag"],
            .ts-stealth-pill,
            .ts-global-pill,
            .ts-db-pill {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: ${g.shape === "pill" ? "20px" : "4px"} !important;
                padding: 1px 8px !important;
                margin: 0 3px !important;
                border: none !important;
                font-size: calc(1em * ${(g.fontSizeMultiplier || 100) / 100}) !important;
                font-weight: 500 !important;
                line-height: 1.25 !important;
                vertical-align: middle !important;
                box-shadow: 0 1px 2px rgba(0,0,0,0.12) !important;
                background-color: ${this.hexToRgba(g.bgColor, g.bgColorAlpha)} !important;
                color: ${this.hexToRgba(g.color, g.colorAlpha)} !important;
                text-decoration: none !important;
                white-space: nowrap !important;
                flex-shrink: 0 !important;
            }

            /* Ensure links inside DB columns don't underline our custom badges */
            .av__cell a { text-decoration: none !important; }

            span[data-type~="tag"]::before {
                ${g.showHash ? 'content: "#" !important; margin-right: 2px !important; opacity: 0.7 !important; display: inline-block !important;' : 'content: "" !important; display: none !important;'}
            }

            /* Float end only in protyle editor to avoid breaking list tree/outline panel layouts */
            ${g.position === "end" ? `.protyle-wysiwyg span[data-type~="tag"] { float: right !important; margin-left: 8px !important; } .protyle-wysiwyg [data-node-id]:has(span[data-type~="tag"])::after { content: ""; display: table; clear: both; }` : ""}
            .ts-stealth-pill mark { background-color: rgba(255, 255, 0, 0.4) !important; color: inherit !important; padding: 0 !important; }
        `;

        if (config.tagStyles) {
            config.tagStyles.forEach((style) => {
                if (!style.name) return;
                const cleanName = style.name.replace(/[​-‍⁠﻿]/g, "").trim();
                if (!cleanName) return;
                const safeId = this.getSafeId(cleanName);

                css += `
                    span[data-type~="tag"][data-tag-name="${cleanName}"],
                    .ts-db-pill[data-tag-name="${cleanName}"],
                    .${safeId} {
                        color: ${this.hexToRgba(style.color || "#ffffff", style.colorAlpha)} !important;
                        background-color: ${this.hexToRgba(style.bgColor || "#3b82f6", style.bgColorAlpha)} !important;
                        border-radius: ${style.shape === "pill" ? "20px" : (style.radius || "4px")} !important;
                    }

                    ${style.showHash === false ? `span[data-type~="tag"][data-tag-name="${cleanName}"]::before { content: "" !important; display: none !important; }` : `span[data-type~="tag"][data-tag-name="${cleanName}"]::before { content: "#" !important; margin-right: 2px !important; opacity: 0.8 !important; display: inline-block !important; }`}
                    ${style.position === "end" ? `.protyle-wysiwyg span[data-type~="tag"][data-tag-name="${cleanName}"] { float: right !important; margin-left: 8px !important; } .protyle-wysiwyg [data-node-id]:has(span[data-tag-name="${cleanName}"])::after { content: ""; display: table; clear: both; }` : `.protyle-wysiwyg span[data-type~="tag"][data-tag-name="${cleanName}"] { float: none !important; margin-left: 4px !important; }`}
                `;
            });
        }
        if (this.styleElement) this.styleElement.textContent = css;
    }

    initSettingUI() {
        this.setting = new siyuan.Setting({
            confirmCallback: () => {
                this.data["config.json"] = JSON.parse(JSON.stringify(this.tempConfig));
                this.saveData("config.json", this.data["config.json"]);
                this.updateStyles();
            }
        });
        this.settingsContainer = document.createElement("div");
        this.settingsContainer.className = "fn__flex-column";
        this.settingsContainer.style.width = "100%";
        this.settingsContainer.style.padding = "0";
        this.setting.addItem({ title: "", description: "", actionElement: this.settingsContainer });
    }

    openSetting() {
        this.tempConfig = JSON.parse(JSON.stringify(this.data["config.json"]));
        this.renderSettingsList();
        this.setting.open("Tag Styler Settings");
    }

    renderSettingsList() {
        this.settingsContainer.innerHTML = "";
        const config = this.tempConfig;

        const globalCard = document.createElement("div");
        globalCard.className = "b3-label fn__flex-column";
        globalCard.style.padding = "16px";
        globalCard.style.border = "1px solid var(--b3-theme-primary-light)";
        globalCard.style.borderRadius = "12px";
        globalCard.style.backgroundColor = "var(--b3-theme-surface-lighter)";
        globalCard.style.gap = "12px";
        globalCard.style.marginBottom = "10px";

        globalCard.innerHTML = `
            <div class="fn__flex" style="align-items: center; gap: 8px;"><svg style="width: 16px; height: 16px; color: var(--b3-theme-primary);"><use xlink:href="#iconSettings"></use></svg><span style="font-weight: 700; color: var(--b3-theme-primary);">Global Defaults</span></div>
            <div class="fn__flex" style="gap: 15px; flex-wrap: wrap; align-items: flex-end;">
                <div class="fn__flex-column" style="gap: 4px;">
                    <label style="font-size: 0.75em; opacity: 0.7;">Text Color</label>
                    <div class="fn__flex" style="gap: 6px; align-items: center;">
                        <input class="b3-input" type="color" value="${config.global.color}" data-key="color" data-target="global" style="width: 38px; height: 30px; padding: 2px; cursor: pointer;">
                        <div class="fn__flex-column" style="gap: 2px; min-width: 80px;">
                            <input class="b3-slider" type="range" min="0" max="100" step="1" value="${config.global.colorAlpha ?? 100}" data-key="colorAlpha" data-target="global" style="width: 100%; cursor: pointer; accent-color: var(--b3-theme-primary);">
                            <span class="ts-alpha-val" style="font-size: 0.65em; opacity: 0.7; text-align: center;">${config.global.colorAlpha ?? 100}%</span>
                        </div>
                    </div>
                </div>
                <div class="fn__flex-column" style="gap: 4px;">
                    <label style="font-size: 0.75em; opacity: 0.7;">Background Color</label>
                    <div class="fn__flex" style="gap: 6px; align-items: center;">
                        <input class="b3-input" type="color" value="${config.global.bgColor}" data-key="bgColor" data-target="global" style="width: 38px; height: 30px; padding: 2px; cursor: pointer;">
                        <div class="fn__flex-column" style="gap: 2px; min-width: 80px;">
                            <input class="b3-slider" type="range" min="0" max="100" step="1" value="${config.global.bgColorAlpha ?? 100}" data-key="bgColorAlpha" data-target="global" style="width: 100%; cursor: pointer; accent-color: var(--b3-theme-primary);">
                            <span class="ts-alpha-val" style="font-size: 0.65em; opacity: 0.7; text-align: center;">${config.global.bgColorAlpha ?? 100}%</span>
                        </div>
                    </div>
                </div>
                <div class="fn__flex-column" style="gap: 4px;">
                    <label style="font-size: 0.75em; opacity: 0.7;">Font Size</label>
                    <div class="fn__flex-column" style="gap: 2px; min-width: 80px;">
                        <input class="b3-slider" type="range" min="50" max="150" step="1" value="${config.global.fontSizeMultiplier ?? 100}" data-key="fontSizeMultiplier" data-target="global" style="width: 100%; cursor: pointer; accent-color: var(--b3-theme-primary);">
                        <span class="ts-font-val" style="font-size: 0.65em; opacity: 0.7; text-align: center;">${config.global.fontSizeMultiplier ?? 100}%</span>
                    </div>
                </div>
                <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.75em; opacity: 0.7;">Shape</label><select class="b3-select" data-key="shape" data-target="global" style="width: 90px;"><option value="pill" ${config.global.shape === "pill" ? "selected" : ""}>Pill</option><option value="rounded" ${config.global.shape === "rounded" ? "selected" : ""}>Rounded</option></select></div>
                <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.75em; opacity: 0.7;">Pos</label><select class="b3-select" data-key="position" data-target="global" style="width: 95px;"><option value="normal" ${config.global.position === "normal" ? "selected" : ""}>Inline</option><option value="end" ${config.global.position === "end" ? "selected" : ""}>Float End</option></select></div>
                <label class="fn__flex" style="align-items: center; gap: 8px; cursor: pointer; padding-bottom: 6px;"><input type="checkbox" class="b3-switch" data-key="showHash" data-target="global" ${config.global.showHash ? "checked" : ""}> <span style="font-size: 0.85em;">Show #</span></label>
            </div>
        `;

        globalCard.querySelectorAll("input, select").forEach(el => {
            el.addEventListener(el.type === "checkbox" ? "change" : "input", (e) => {
                const key = e.target.getAttribute("data-key");
                let val;
                if (e.target.type === "checkbox") val = e.target.checked;
                else if (e.target.type === "range") val = parseInt(e.target.value, 10);
                else val = e.target.value;
                config.global[key] = val;
                // Update alpha/font label
                const card = e.target.closest(".b3-label");
                if (key === "colorAlpha" && card) { const label = card.querySelector(".ts-alpha-val"); if (label) label.textContent = val + "%"; }
                if (key === "bgColorAlpha" && card) { const labels = card.querySelectorAll(".ts-alpha-val"); if (labels[1]) labels[1].textContent = val + "%"; }
                if (key === "fontSizeMultiplier" && card) { const label = card.querySelector(".ts-font-val"); if (label) label.textContent = val + "%"; }
            });
        });
        this.settingsContainer.appendChild(globalCard);

        const listContainer = document.createElement("div");
        listContainer.className = "fn__flex-column";
        listContainer.style.gap = "8px";
        this.settingsContainer.appendChild(listContainer);

        config.tagStyles.forEach((style, index) => {
            const card = document.createElement("div");
            card.className = "b3-label fn__flex-column";
            card.style.padding = "12px"; card.style.border = "1px solid var(--b3-border-color)"; card.style.borderRadius = "10px"; card.style.backgroundColor = "var(--b3-theme-surface)"; card.style.gap = "10px";
            card.innerHTML = `
                <div class="fn__flex" style="align-items: center; justify-content: space-between;"><input class="b3-input" value="${style.name}" placeholder="Tag Name" style="width: 160px; font-weight: 600;" data-key="name"><div class="fn__flex" style="gap: 8px;"><div class="tag-preview" style="padding: 2px 12px; border-radius: ${style.shape === "pill" ? "20px" : "4px"}; background-color: ${style.bgColor}; color: ${style.color}; font-weight: 600; font-size: 0.85em; display: flex; align-items: center;">${style.showHash !== false ? "#" : ""}${style.name}</div><button class="b3-button b3-button--cancel delete-btn" style="padding: 4px 8px;"><svg style="width: 12px; height: 12px;"><use xlink:href="#iconTrashcan"></use></svg></button></div></div>
                <div class="fn__flex" style="gap: 12px; flex-wrap: wrap; align-items: flex-end;">
                    <div class="fn__flex-column" style="gap: 4px;">
                        <label style="font-size: 0.7em; opacity: 0.6;">Text Color</label>
                        <div class="fn__flex" style="gap: 6px; align-items: center;">
                            <input class="b3-input" type="color" value="${style.color || "#ffffff"}" data-key="color" style="width: 35px; height: 30px; padding: 2px; cursor: pointer;">
                            <div class="fn__flex-column" style="gap: 2px; min-width: 70px;">
                                <input class="b3-slider ts-tag-color-alpha" type="range" min="0" max="100" step="1" value="${style.colorAlpha ?? 100}" data-key="colorAlpha" style="width: 100%; cursor: pointer; accent-color: var(--b3-theme-primary);">
                                <span class="ts-tag-color-alpha-val" style="font-size: 0.65em; opacity: 0.7; text-align: center;">${style.colorAlpha ?? 100}%</span>
                            </div>
                        </div>
                    </div>
                    <div class="fn__flex-column" style="gap: 4px;">
                        <label style="font-size: 0.7em; opacity: 0.6;">Background</label>
                        <div class="fn__flex" style="gap: 6px; align-items: center;">
                            <input class="b3-input" type="color" value="${style.bgColor || "#3b82f6"}" data-key="bgColor" style="width: 35px; height: 30px; padding: 2px; cursor: pointer;">
                            <div class="fn__flex-column" style="gap: 2px; min-width: 70px;">
                                <input class="b3-slider ts-tag-bg-alpha" type="range" min="0" max="100" step="1" value="${style.bgColorAlpha ?? 100}" data-key="bgColorAlpha" style="width: 100%; cursor: pointer; accent-color: var(--b3-theme-primary);">
                                <span class="ts-tag-bg-alpha-val" style="font-size: 0.65em; opacity: 0.7; text-align: center;">${style.bgColorAlpha ?? 100}%</span>
                            </div>
                        </div>
                    </div>
                    <div class="fn__flex-column" style="gap: 4px;">
                        <label style="font-size: 0.7em; opacity: 0.6;">Font Size</label>
                        <div class="fn__flex-column" style="gap: 2px; min-width: 70px;">
                            <input class="b3-slider ts-tag-font" type="range" min="50" max="150" step="1" value="${style.fontSizeMultiplier ?? 100}" data-key="fontSizeMultiplier" style="width: 100%; cursor: pointer; accent-color: var(--b3-theme-primary);">
                            <span class="ts-tag-font-val" style="font-size: 0.65em; opacity: 0.7; text-align: center;">${style.fontSizeMultiplier ?? 100}%</span>
                        </div>
                    </div>
                    <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.7em; opacity: 0.6;">Shape</label><select class="b3-select" data-key="shape" style="width: 85px;"><option value="pill" ${style.shape === "pill" ? "selected" : ""}>Pill</option><option value="rounded" ${style.shape === "rounded" ? "selected" : ""}>Rounded</option></select></div>
                    <div class="fn__flex-column" style="gap: 4px;"><label style="font-size: 0.7em; opacity: 0.6;">Pos</label><select class="b3-select" data-key="position" style="width: 95px;"><option value="normal" ${style.position === "normal" ? "selected" : ""}>Inline</option><option value="end" ${style.position === "end" ? "selected" : ""}>Float End</option></select></div>
                    <label class="fn__flex" style="align-items: center; gap: 4px; cursor: pointer; padding-bottom: 6px;"><input type="checkbox" class="b3-switch" data-key="showHash" ${style.showHash !== false ? "checked" : ""}> <span style="font-size: 0.8em; opacity: 0.8;">#</span></label>
                </div>`;

            const preview = card.querySelector(".tag-preview");
            card.querySelectorAll("input, select").forEach((input) => {
                input.addEventListener(input.type === "checkbox" ? "change" : "input", (e) => {
                    const key = e.target.getAttribute("data-key");
                    let val;
                    if (e.target.type === "checkbox") val = e.target.checked;
                    else if (e.target.type === "range") val = parseInt(e.target.value, 10);
                    else val = e.target.value;
                    style[key] = val;
                    if (key === "name" || key === "showHash") preview.textContent = (style.showHash !== false ? "#" : "") + style.name;
                    if (key === "color") preview.style.color = style.color;
                    if (key === "bgColor") preview.style.backgroundColor = style.bgColor;
                    if (key === "shape") preview.style.borderRadius = style.shape === "pill" ? "20px" : "4px";
                    if (key === "colorAlpha") { const l = card.querySelector(".ts-tag-color-alpha-val"); if (l) l.textContent = val + "%"; }
                    if (key === "bgColorAlpha") { const l = card.querySelector(".ts-tag-bg-alpha-val"); if (l) l.textContent = val + "%"; }
                    if (key === "fontSizeMultiplier") { const l = card.querySelector(".ts-tag-font-val"); if (l) l.textContent = val + "%"; }
                });
            });
            card.querySelector(".delete-btn").onclick = () => { config.tagStyles.splice(index, 1); this.renderSettingsList(); };
            listContainer.appendChild(card);
        });

        const addBtn = document.createElement("button");
        addBtn.className = "b3-button b3-button--text fn__block"; addBtn.style.padding = "10px"; addBtn.style.border = "2px dashed var(--b3-border-color)"; addBtn.style.marginTop = "5px";
        addBtn.innerHTML = `<svg style="width: 14px; height: 14px; margin-right: 8px; vertical-align: middle;"><use xlink:href="#iconAdd"></use></svg>Add Tag Customization`;
        addBtn.onclick = () => { config.tagStyles.push({ name: "new-tag", color: "#ffffff", colorAlpha: 100, bgColor: "#3b82f6", bgColorAlpha: 100, fontSizeMultiplier: 100, shape: "pill", radius: "4px", position: "normal", showHash: true }); this.renderSettingsList(); };
        this.settingsContainer.appendChild(addBtn);
    }
}

module.exports = TagStylerPlugin;