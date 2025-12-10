import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, getRequestHeaders } from "../../../../script.js";
import { EXT_ID, EXT_NAME, extensionFolderPath } from "./core/constants.js";
import { executeSlashCommand } from "./core/slash-command.js";
import { EventCenter } from "./core/event-manager.js";
import { initTasks } from "./modules/scheduled-tasks/scheduled-tasks.js";
import { initScriptAssistant } from "./modules/script-assistant.js";
import { initMessagePreview, addHistoryButtonsDebounced } from "./modules/message-preview.js";
import { initImmersiveMode } from "./modules/immersive-mode.js";
import { initTemplateEditor, templateSettings } from "./modules/template-editor/template-editor.js";
import { initWallhavenBackground } from "./modules/wallhaven-background.js";
import { initDynamicPrompt } from "./modules/dynamic-prompt.js";
import { initButtonCollapse } from "./modules/button-collapse.js";
import { initVariablesPanel, getVariablesPanelInstance, cleanupVariablesPanel } from "./modules/variables/variables-panel.js";
import { initStreamingGeneration } from "./modules/streaming-generation.js";
import { initVariablesCore, cleanupVariablesCore } from "./modules/variables/variables-core.js";
import { initControlAudio } from "./modules/control-audio.js";
import {
    initRenderer,
    cleanupRenderer,
    processExistingMessages,
    processMessageById,
    invalidateAll,
    clearBlobCaches,
    renderHtmlInIframe,
    shrinkRenderedWindowFull
} from "./modules/iframe-renderer.js";
import "./modules/story-summary/story-summary.js";
import "./modules/story-outline/story-outline.js";

const MODULE_NAME = "xiaobaix-memory";

extension_settings[EXT_ID] = extension_settings[EXT_ID] || {
    enabled: true,
    sandboxMode: false,
    recorded: { enabled: true },
    templateEditor: { enabled: true, characterBindings: {} },
    tasks: { enabled: true, globalTasks: [], processedMessages: [], character_allowed_tasks: [] },
    scriptAssistant: { enabled: false },
    preview: { enabled: false },
    wallhaven: { enabled: false },
    immersive: { enabled: false },
    dynamicPrompt: { enabled: true },
    audio: { enabled: true },
    variablesPanel: { enabled: false },
    variablesCore: { enabled: true },
    storySummary: { enabled: true },
    storyOutline: { enabled: true },
    useBlob: false,
    wrapperIframe: true,
    renderEnabled: true,
    maxRenderedMessages: 5,
};

const settings = extension_settings[EXT_ID];
let isXiaobaixEnabled = settings.enabled;
let moduleCleanupFunctions = new Map();
let updateCheckPerformed = false;

window.isXiaobaixEnabled = isXiaobaixEnabled;
window.testLittleWhiteBoxUpdate = async () => {
    updateCheckPerformed = false;
    await performExtensionUpdateCheck();
};
window.testUpdateUI = () => {
    updateExtensionHeaderWithUpdateNotice();
};
window.testRemoveUpdateUI = () => {
    removeAllUpdateNotices();
};

async function checkLittleWhiteBoxUpdate() {
    try {
        const timestamp = Date.now();
        const localRes = await fetch(`${extensionFolderPath}/manifest.json?t=${timestamp}`, { cache: 'no-cache' });
        if (!localRes.ok) return null;
        const localManifest = await localRes.json();
        const localVersion = localManifest.version;
        const remoteRes = await fetch(`https://api.github.com/repos/RT15548/LittleWhiteBox/contents/manifest.json?t=${timestamp}`, { cache: 'no-cache' });
        if (!remoteRes.ok) return null;
        const remoteData = await remoteRes.json();
        const remoteManifest = JSON.parse(atob(remoteData.content));
        const remoteVersion = remoteManifest.version;
        return localVersion !== remoteVersion ? { isUpToDate: false, localVersion, remoteVersion } : { isUpToDate: true, localVersion, remoteVersion };
    } catch (e) {
        return null;
    }
}

async function updateLittleWhiteBoxExtension() {
    try {
        const response = await fetch('/api/extensions/update', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName: 'LittleWhiteBox', global: true }),
        });
        if (!response.ok) {
            const text = await response.text();
            toastr.error(text || response.statusText, '小白X更新失败', { timeOut: 5000 });
            return false;
        }
        const data = await response.json();
        const message = data.isUpToDate ? '小白X已是最新版本' : `小白X已更新`;
        const title = data.isUpToDate ? '' : '请刷新页面以应用更新';
        toastr.success(message, title);
        return true;
    } catch (error) {
        toastr.error('更新过程中发生错误', '小白X更新失败');
        return false;
    }
}

function updateExtensionHeaderWithUpdateNotice() {
    addUpdateTextNotice();
    addUpdateDownloadButton();
}

function addUpdateTextNotice() {
    const selectors = [
        '.inline-drawer-toggle.inline-drawer-header b',
        '.inline-drawer-header b',
        '.littlewhitebox .inline-drawer-header b',
        'div[class*="inline-drawer"] b'
    ];
    let headerElement = null;
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
            if (element.textContent && element.textContent.includes('小白X')) {
                headerElement = element;
                break;
            }
        }
        if (headerElement) break;
    }
    if (!headerElement) {
        setTimeout(() => addUpdateTextNotice(), 1000);
        return;
    }
    if (headerElement.querySelector('.littlewhitebox-update-text')) return;
    const updateTextSmall = document.createElement('small');
    updateTextSmall.className = 'littlewhitebox-update-text';
    updateTextSmall.textContent = '(有可用更新)';
    headerElement.appendChild(updateTextSmall);
}

function addUpdateDownloadButton() {
    const sectionDividers = document.querySelectorAll('.section-divider');
    let totalSwitchDivider = null;
    for (const divider of sectionDividers) {
        if (divider.textContent && divider.textContent.includes('总开关')) {
            totalSwitchDivider = divider;
            break;
        }
    }
    if (!totalSwitchDivider) {
        setTimeout(() => addUpdateDownloadButton(), 1000);
        return;
    }
    if (document.querySelector('#littlewhitebox-update-extension')) return;
    const updateButton = document.createElement('div');
    updateButton.id = 'littlewhitebox-update-extension';
    updateButton.className = 'menu_button fa-solid fa-cloud-arrow-down interactable has-update';
    updateButton.title = '下载并安装小白x的更新';
    updateButton.tabIndex = 0;
    try {
        totalSwitchDivider.style.display = 'flex';
        totalSwitchDivider.style.alignItems = 'center';
        totalSwitchDivider.style.justifyContent = 'flex-start';
    } catch (e) {}
    totalSwitchDivider.appendChild(updateButton);
    try {
        if (window.setupUpdateButtonInSettings) {
            window.setupUpdateButtonInSettings();
        }
    } catch (e) {}
}

function removeAllUpdateNotices() {
    const textNotice = document.querySelector('.littlewhitebox-update-text');
    const downloadButton = document.querySelector('#littlewhitebox-update-extension');
    if (textNotice) textNotice.remove();
    if (downloadButton) downloadButton.remove();
}

async function performExtensionUpdateCheck() {
    if (updateCheckPerformed) return;
    updateCheckPerformed = true;
    try {
        const versionData = await checkLittleWhiteBoxUpdate();
        if (versionData && versionData.isUpToDate === false) {
            updateExtensionHeaderWithUpdateNotice();
        }
    } catch (error) {}
}

function registerModuleCleanup(moduleName, cleanupFunction) {
    moduleCleanupFunctions.set(moduleName, cleanupFunction);
}

function removeSkeletonStyles() {
    try {
        document.querySelectorAll('.xiaobaix-skel').forEach(el => {
            try { el.remove(); } catch (e) {}
        });
        document.getElementById('xiaobaix-skeleton-style')?.remove();
    } catch (e) {}
}

function cleanupAllResources() {
    try {
        EventCenter.cleanupAll();
    } catch (e) {}
    
    moduleCleanupFunctions.forEach((cleanupFn) => {
        try {
            cleanupFn();
        } catch (e) {}
    });
    moduleCleanupFunctions.clear();
    
    try {
        cleanupRenderer();
    } catch (e) {}
    
    document.querySelectorAll('.memory-button, .mes_history_preview').forEach(btn => btn.remove());
    document.querySelectorAll('#message_preview_btn').forEach(btn => {
        if (btn instanceof HTMLElement) {
            btn.style.display = 'none';
        }
    });
    document.getElementById('xiaobaix-hide-code')?.remove();
    document.body.classList.remove('xiaobaix-active');
    document.querySelectorAll('pre[data-xiaobaix-bound="true"]').forEach(pre => {
        pre.classList.remove('xb-show');
        pre.removeAttribute('data-xbfinal');
        delete pre.dataset.xbFinal;
        pre.style.display = '';
        delete pre.dataset.xiaobaixBound;
    });
    removeSkeletonStyles();
}

async function waitForElement(selector, root = document, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const element = root.querySelector(selector);
        if (element) return element;
        await new Promise(r => setTimeout(r, 100));
    }
    return null;
}

function toggleSettingsControls(enabled) {
    const controls = [
        'xiaobaix_sandbox', 'xiaobaix_recorded_enabled', 'xiaobaix_preview_enabled',
        'xiaobaix_script_assistant', 'scheduled_tasks_enabled', 'xiaobaix_template_enabled',
        'wallhaven_enabled', 'wallhaven_bg_mode', 'wallhaven_category',
        'wallhaven_purity', 'wallhaven_opacity',
        'xiaobaix_immersive_enabled', 'xiaobaix_dynamic_prompt_enabled',
        'xiaobaix_audio_enabled', 'xiaobaix_variables_panel_enabled',
        'xiaobaix_use_blob', 'xiaobaix_variables_core_enabled', 'Wrapperiframe', 'xiaobaix_render_enabled',
        'xiaobaix_max_rendered', 'xiaobaix_story_outline_enabled', 'xiaobaix_story_summary_enabled'
    ];
    controls.forEach(id => {
        $(`#${id}`).prop('disabled', !enabled).closest('.flex-container').toggleClass('disabled-control', !enabled);
    });
    const styleId = 'xiaobaix-disabled-style';
    if (!enabled && !document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `.disabled-control, .disabled-control * { opacity: 0.4 !important; pointer-events: none !important; cursor: not-allowed !important; }`;
        document.head.appendChild(style);
    } else if (enabled) {
        document.getElementById(styleId)?.remove();
    }
}

function ensureHideCodeStyle(enable) {
    const id = 'xiaobaix-hide-code';
    const old = document.getElementById(id);
    if (!enable) {
        old?.remove();
        return;
    }
    if (old) return;
    const hideCodeStyle = document.createElement('style');
    hideCodeStyle.id = id;
    hideCodeStyle.textContent = `
        .xiaobaix-active .mes_text pre { display: none !important; }
        .xiaobaix-active .mes_text pre.xb-show { display: block !important; }
    `;
    document.head.appendChild(hideCodeStyle);
}

function setActiveClass(enable) {
    document.body.classList.toggle('xiaobaix-active', !!enable);
}

function toggleAllFeatures(enabled) {
    if (enabled) {
        if (settings.renderEnabled !== false) {
            ensureHideCodeStyle(true);
            setActiveClass(true);
        }
        toggleSettingsControls(true);
        try { window.XB_applyPrevStates && window.XB_applyPrevStates(); } catch (e) {}
        saveSettingsDebounced();
        
        initRenderer();
        
        const moduleInits = [
            { condition: extension_settings[EXT_ID].tasks?.enabled, init: initTasks },
            { condition: extension_settings[EXT_ID].scriptAssistant?.enabled, init: initScriptAssistant },
            { condition: extension_settings[EXT_ID].immersive?.enabled, init: initImmersiveMode },
            { condition: extension_settings[EXT_ID].templateEditor?.enabled, init: initTemplateEditor },
            { condition: extension_settings[EXT_ID].wallhaven?.enabled, init: initWallhavenBackground },
            { condition: extension_settings[EXT_ID].dynamicPrompt?.enabled, init: initDynamicPrompt },
            { condition: extension_settings[EXT_ID].variablesPanel?.enabled, init: initVariablesPanel },
            { condition: extension_settings[EXT_ID].variablesCore?.enabled, init: initVariablesCore },
            { condition: true, init: initStreamingGeneration },
            { condition: true, init: initButtonCollapse }
        ];
        moduleInits.forEach(({ condition, init }) => {
            if (condition) init();
        });
        if (extension_settings[EXT_ID].preview?.enabled || extension_settings[EXT_ID].recorded?.enabled) {
            setTimeout(initMessagePreview, 200);
        }
        if (extension_settings[EXT_ID].scriptAssistant?.enabled && window.injectScriptDocs)
            setTimeout(() => window.injectScriptDocs(), 400);
        if (extension_settings[EXT_ID].preview?.enabled)
            setTimeout(() => { document.querySelectorAll('#message_preview_btn').forEach(btn => btn.style.display = ''); }, 500);
        if (extension_settings[EXT_ID].recorded?.enabled)
            setTimeout(() => addHistoryButtonsDebounced(), 600);
        try {
            if (isXiaobaixEnabled && settings.wrapperIframe && !document.getElementById('xb-callgen'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-callgen', type: 'module', src: `${extensionFolderPath}/bridges/call-generate-service.js` }));
        } catch (e) {}
        try {
            if (isXiaobaixEnabled && !document.getElementById('xb-worldbook'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-worldbook', type: 'module', src: `${extensionFolderPath}/bridges/worldbook-bridge.js` }));
        } catch (e) {}
        document.dispatchEvent(new CustomEvent('xiaobaixEnabledChanged', { detail: { enabled: true } }));
        $(document).trigger('xiaobaix:enabled:toggle', [true]);
    } else {
        try { window.XB_captureAndStoreStates && window.XB_captureAndStoreStates(); } catch (e) {}
        cleanupAllResources();
        if (window.messagePreviewCleanup) try { window.messagePreviewCleanup(); } catch (e) {}
        if (window.dynamicPromptCleanup) try { window.dynamicPromptCleanup(); } catch (e) {}
        if (window.buttonCollapseCleanup) try { window.buttonCollapseCleanup(); } catch (e) {}
        try { cleanupVariablesPanel(); } catch (e) {}
        try { cleanupVariablesCore(); } catch (e) {}
        try { clearBlobCaches(); } catch (e) {}
        toggleSettingsControls(false);
        document.getElementById('xiaobaix-hide-code')?.remove();
        setActiveClass(false);
        document.querySelectorAll('pre[data-xiaobaix-bound="true"]').forEach(pre => {
            pre.classList.remove('xb-show');
            pre.removeAttribute('data-xbfinal');
            delete pre.dataset.xbFinal;
            pre.style.display = '';
            delete pre.dataset.xiaobaixBound;
        });
        window.removeScriptDocs?.();
        try { window.cleanupWorldbookHostBridge && window.cleanupWorldbookHostBridge(); document.getElementById('xb-worldbook')?.remove(); } catch (e) {}
        try { window.cleanupCallGenerateHostBridge && window.cleanupCallGenerateHostBridge(); document.getElementById('xb-callgen')?.remove(); } catch (e) {}
        document.dispatchEvent(new CustomEvent('xiaobaixEnabledChanged', { detail: { enabled: false } }));
        $(document).trigger('xiaobaix:enabled:toggle', [false]);
    }
}

async function setupSettings() {
    try {
        const settingsContainer = await waitForElement("#extensions_settings");
        if (!settingsContainer) return;
        const response = await fetch(`${extensionFolderPath}/settings.html`);
        const settingsHtml = await response.text();
        $(settingsContainer).append(settingsHtml);
        $("#xiaobaix_enabled").prop("checked", settings.enabled).on("change", function () {
            const wasEnabled = settings.enabled;
            settings.enabled = $(this).prop("checked");
            isXiaobaixEnabled = settings.enabled;
            window.isXiaobaixEnabled = isXiaobaixEnabled;
            saveSettingsDebounced();
            if (settings.enabled !== wasEnabled) {
                toggleAllFeatures(settings.enabled);
            }
        });
        if (!settings.enabled) toggleSettingsControls(false);
        $("#xiaobaix_sandbox").prop("checked", settings.sandboxMode).on("change", function () {
            if (!isXiaobaixEnabled) return;
            settings.sandboxMode = $(this).prop("checked");
            saveSettingsDebounced();
        });
        const moduleConfigs = [
            { id: 'xiaobaix_recorded_enabled', key: 'recorded' },
            { id: 'xiaobaix_immersive_enabled', key: 'immersive', init: initImmersiveMode },
            { id: 'xiaobaix_preview_enabled', key: 'preview', init: initMessagePreview },
            { id: 'xiaobaix_script_assistant', key: 'scriptAssistant', init: initScriptAssistant },
            { id: 'scheduled_tasks_enabled', key: 'tasks', init: initTasks },
            { id: 'xiaobaix_template_enabled', key: 'templateEditor', init: initTemplateEditor },
            { id: 'wallhaven_enabled', key: 'wallhaven', init: initWallhavenBackground },
            { id: 'xiaobaix_dynamic_prompt_enabled', key: 'dynamicPrompt', init: initDynamicPrompt },
            { id: 'xiaobaix_variables_panel_enabled', key: 'variablesPanel', init: initVariablesPanel },
            { id: 'xiaobaix_variables_core_enabled', key: 'variablesCore', init: initVariablesCore },
            { id: 'xiaobaix_story_summary_enabled', key: 'storySummary' },
            { id: 'xiaobaix_story_outline_enabled', key: 'storyOutline' }
        ];
        moduleConfigs.forEach(({ id, key, init }) => {
            $(`#${id}`).prop("checked", settings[key]?.enabled || false).on("change", function () {
                if (!isXiaobaixEnabled) return;
                const enabled = $(this).prop('checked');
                settings[key] = extension_settings[EXT_ID][key] || {};
                settings[key].enabled = enabled;
                extension_settings[EXT_ID][key] = settings[key];
                saveSettingsDebounced();
                if (moduleCleanupFunctions.has(key)) {
                    moduleCleanupFunctions.get(key)();
                    moduleCleanupFunctions.delete(key);
                }
                if (enabled && init) init();
                if (key === 'storySummary') {
                    $(document).trigger('xiaobaix:storySummary:toggle', [enabled]);
                }
                if (key === 'storyOutline') {
                    $(document).trigger('xiaobaix:storyOutline:toggle', [enabled]);
                }
            });
        });
        $("#xiaobaix_use_blob").prop("checked", !!settings.useBlob).on("change", function () {
            if (!isXiaobaixEnabled) return;
            settings.useBlob = $(this).prop("checked");
            saveSettingsDebounced();
        });
        $("#Wrapperiframe").prop("checked", !!settings.wrapperIframe).on("change", function () {
            if (!isXiaobaixEnabled) return;
            settings.wrapperIframe = $(this).prop("checked");
            saveSettingsDebounced();
            try {
                settings.wrapperIframe
                    ? (!document.getElementById('xb-callgen') && document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-callgen', type: 'module', src: `${extensionFolderPath}/bridges/call-generate-service.js` })))
                    : (window.cleanupCallGenerateHostBridge && window.cleanupCallGenerateHostBridge(), document.getElementById('xb-callgen')?.remove());
            } catch (e) {}
        });
        $("#xiaobaix_render_enabled").prop("checked", settings.renderEnabled !== false).on("change", function () {
            if (!isXiaobaixEnabled) return;
            const wasEnabled = settings.renderEnabled !== false;
            settings.renderEnabled = $(this).prop("checked");
            saveSettingsDebounced();
            if (!settings.renderEnabled && wasEnabled) {
                document.getElementById('xiaobaix-hide-code')?.remove();
                document.body.classList.remove('xiaobaix-active');
                invalidateAll();
            } else if (settings.renderEnabled && !wasEnabled) {
                ensureHideCodeStyle(true);
                document.body.classList.add('xiaobaix-active');
                setTimeout(() => processExistingMessages(), 100);
            }
        });

        const normalizeMaxRendered = (raw) => {
            let v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 1) v = 1;
            if (v > 9999) v = 9999;
            return v;
        };
        $("#xiaobaix_max_rendered")
            .val(Number.isFinite(settings.maxRenderedMessages) ? settings.maxRenderedMessages : 5)
            .on("input change", function () {
                if (!isXiaobaixEnabled) return;
                const v = normalizeMaxRendered($(this).val());
                $(this).val(v);
                settings.maxRenderedMessages = v;
                saveSettingsDebounced();
                try { shrinkRenderedWindowFull(); } catch (e) {}
            });
        
        $(document).off('click.xbreset', '#xiaobaix_reset_btn').on('click.xbreset', '#xiaobaix_reset_btn', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const MAP = {
                recorded: 'xiaobaix_recorded_enabled',
                immersive: 'xiaobaix_immersive_enabled',
                preview: 'xiaobaix_preview_enabled',
                scriptAssistant: 'xiaobaix_script_assistant',
                tasks: 'scheduled_tasks_enabled',
                templateEditor: 'xiaobaix_template_enabled',
                wallhaven: 'wallhaven_enabled',
                dynamicPrompt: 'xiaobaix_dynamic_prompt_enabled',
                variablesPanel: 'xiaobaix_variables_panel_enabled',
                variablesCore: 'xiaobaix_variables_core_enabled'
            };
            const ON = ['templateEditor', 'tasks', 'dynamicPrompt', 'variablesCore'];
            const OFF = ['recorded', 'preview', 'scriptAssistant', 'immersive', 'wallhaven', 'variablesPanel'];
            function setChecked(id, val) {
                const el = document.getElementById(id);
                if (el) {
                    el.checked = !!val;
                    try { $(el).trigger('change'); } catch {}
                }
            }
            ON.forEach(k => setChecked(MAP[k], true));
            OFF.forEach(k => setChecked(MAP[k], false));
            setChecked('xiaobaix_sandbox', false);
            setChecked('xiaobaix_use_blob', false);
            setChecked('Wrapperiframe', true);
            try { saveSettingsDebounced(); } catch (e) {}
        });
    } catch (err) {}
}

function setupMenuTabs() {
    $(document).on('click', '.menu-tab', function () {
        const targetId = $(this).attr('data-target');
        $('.menu-tab').removeClass('active');
        $('.settings-section').hide();
        $(this).addClass('active');
        $('.' + targetId).show();
    });
    setTimeout(() => {
        $('.js-memory').show();
        $('.task, .instructions').hide();
        $('.menu-tab[data-target="js-memory"]').addClass('active');
        $('.menu-tab[data-target="task"], .menu-tab[data-target="instructions"]').removeClass('active');
    }, 300);
}

window.processExistingMessages = processExistingMessages;
window.renderHtmlInIframe = renderHtmlInIframe;
window.registerModuleCleanup = registerModuleCleanup;
window.updateLittleWhiteBoxExtension = updateLittleWhiteBoxExtension;
window.removeAllUpdateNotices = removeAllUpdateNotices;

jQuery(async () => {
    try {
        isXiaobaixEnabled = settings.enabled;
        window.isXiaobaixEnabled = isXiaobaixEnabled;
        if (isXiaobaixEnabled && settings.renderEnabled !== false) {
            ensureHideCodeStyle(true);
            setActiveClass(true);
        }
        if (!document.getElementById('xiaobaix-skeleton-style')) {
            const skelStyle = document.createElement('style');
            skelStyle.id = 'xiaobaix-skeleton-style';
            skelStyle.textContent = `.xiaobaix-iframe-wrapper{position:relative}`;
            document.head.appendChild(skelStyle);
        }
        const response = await fetch(`${extensionFolderPath}/style.css`);
        const styleElement = document.createElement('style');
        styleElement.textContent = await response.text();
        document.head.appendChild(styleElement);
        await setupSettings();
        try { initControlAudio(); } catch (e) {}
        
        if (isXiaobaixEnabled) {
            initRenderer();
        }
        
        try {
            if (isXiaobaixEnabled && settings.wrapperIframe && !document.getElementById('xb-callgen'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-callgen', type: 'module', src: `${extensionFolderPath}/bridges/call-generate-service.js` }));
        } catch (e) {}
        try {
            if (isXiaobaixEnabled && !document.getElementById('xb-worldbook'))
                document.head.appendChild(Object.assign(document.createElement('script'), { id: 'xb-worldbook', type: 'module', src: `${extensionFolderPath}/bridges/worldbook-bridge.js` }));
        } catch (e) {}
        eventSource.on(event_types.APP_READY, () => {
            setTimeout(performExtensionUpdateCheck, 2000);
        });
        if (isXiaobaixEnabled) {
            const moduleInits = [
                { condition: settings.tasks?.enabled, init: initTasks },
                { condition: settings.scriptAssistant?.enabled, init: initScriptAssistant },
                { condition: settings.immersive?.enabled, init: initImmersiveMode },
                { condition: settings.templateEditor?.enabled, init: initTemplateEditor },
                { condition: settings.wallhaven?.enabled, init: initWallhavenBackground },
                { condition: settings.dynamicPrompt?.enabled, init: initDynamicPrompt },
                { condition: settings.variablesPanel?.enabled, init: initVariablesPanel },
                { condition: settings.variablesCore?.enabled, init: initVariablesCore },
                { condition: true, init: initStreamingGeneration },
                { condition: true, init: initButtonCollapse }
            ];
            moduleInits.forEach(({ condition, init }) => { if (condition) init(); });
            if (settings.preview?.enabled || settings.recorded?.enabled) {
                setTimeout(initMessagePreview, 1500);
            }
        }
        setTimeout(setupMenuTabs, 500);
        setTimeout(() => {
            if (window.messagePreviewCleanup) {
                registerModuleCleanup('messagePreview', window.messagePreviewCleanup);
            }
        }, 2000);
        setInterval(() => {
            if (isXiaobaixEnabled) processExistingMessages();
        }, 30000);
    } catch (err) {}
});

export { executeSlashCommand };