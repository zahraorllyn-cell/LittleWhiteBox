/**
 * 统一事件管理中心 - 全局单例
 * 所有模块通过 moduleId 注册事件，统一管理生命周期
 */

import { eventSource, event_types } from "../../../../../script.js";

// 全局事件注册表：moduleId -> [{ eventType, handler }]
const registry = new Map();

// 模块间通信的自定义事件
const customEvents = new Map();

/**
 * 事件管理中心
 */
export const EventCenter = {
    /**
     * 为模块注册事件监听
     * @param {string} moduleId - 模块标识
     * @param {string} eventType - 事件类型
     * @param {Function} handler - 处理函数
     */
    on(moduleId, eventType, handler) {
        if (!moduleId || !eventType || typeof handler !== 'function') return;
        
        if (!registry.has(moduleId)) {
            registry.set(moduleId, []);
        }
        
        try {
            eventSource.on(eventType, handler);
            registry.get(moduleId).push({ eventType, handler });
        } catch (e) {
            console.error(`[EventCenter] Failed to register ${eventType} for ${moduleId}:`, e);
        }
    },

    /**
     * 为模块批量注册多个事件到同一处理函数
     * @param {string} moduleId - 模块标识
     * @param {string[]} eventTypes - 事件类型数组
     * @param {Function} handler - 处理函数
     */
    onMany(moduleId, eventTypes, handler) {
        if (!Array.isArray(eventTypes)) return;
        eventTypes.filter(Boolean).forEach(type => this.on(moduleId, type, handler));
    },

    /**
     * 移除模块的单个事件监听
     * @param {string} moduleId - 模块标识
     * @param {string} eventType - 事件类型
     * @param {Function} handler - 处理函数
     */
    off(moduleId, eventType, handler) {
        try {
            eventSource.removeListener(eventType, handler);
            const listeners = registry.get(moduleId);
            if (listeners) {
                const idx = listeners.findIndex(l => l.eventType === eventType && l.handler === handler);
                if (idx !== -1) listeners.splice(idx, 1);
            }
        } catch (e) {}
    },

    /**
     * 清理单个模块的所有事件
     * @param {string} moduleId - 模块标识
     */
    cleanup(moduleId) {
        const listeners = registry.get(moduleId);
        if (!listeners) return;
        
        listeners.forEach(({ eventType, handler }) => {
            try {
                eventSource.removeListener(eventType, handler);
            } catch (e) {}
        });
        
        registry.delete(moduleId);
    },

    /**
     * 清理所有模块的所有事件（插件卸载时调用）
     */
    cleanupAll() {
        for (const moduleId of registry.keys()) {
            this.cleanup(moduleId);
        }
        customEvents.clear();
    },

    /**
     * 获取模块的事件数量
     * @param {string} moduleId - 模块标识
     */
    count(moduleId) {
        return registry.get(moduleId)?.length || 0;
    },

    /**
     * 获取所有已注册模块的统计信息
     */
    stats() {
        const stats = {};
        for (const [moduleId, listeners] of registry) {
            stats[moduleId] = listeners.length;
        }
        return stats;
    },

    // ========== 模块间通信 ==========

    /**
     * 发布自定义事件（模块间通信）
     * @param {string} eventName - 自定义事件名
     * @param {*} data - 事件数据
     */
    emit(eventName, data) {
        const handlers = customEvents.get(eventName);
        if (!handlers) return;
        handlers.forEach(({ handler }) => {
            try { handler(data); } catch (e) {}
        });
    },

    /**
     * 订阅自定义事件
     * @param {string} moduleId - 模块标识
     * @param {string} eventName - 自定义事件名
     * @param {Function} handler - 处理函数
     */
    subscribe(moduleId, eventName, handler) {
        if (!customEvents.has(eventName)) {
            customEvents.set(eventName, []);
        }
        customEvents.get(eventName).push({ moduleId, handler });
    },

    /**
     * 取消订阅自定义事件
     * @param {string} moduleId - 模块标识
     * @param {string} eventName - 自定义事件名
     */
    unsubscribe(moduleId, eventName) {
        const handlers = customEvents.get(eventName);
        if (handlers) {
            const filtered = handlers.filter(h => h.moduleId !== moduleId);
            if (filtered.length) customEvents.set(eventName, filtered);
            else customEvents.delete(eventName);
        }
    }
};

/**
 * 创建模块专属的事件管理器（简化 API）
 * @param {string} moduleId - 模块标识
 * @returns 模块专属事件管理器
 * 
 * @example
 * const events = createModuleEvents('scriptAssistant');
 * events.on(event_types.CHAT_CHANGED, handler);
 * events.cleanup(); // 只清理本模块
 */
export function createModuleEvents(moduleId) {
    return {
        on: (eventType, handler) => EventCenter.on(moduleId, eventType, handler),
        onMany: (eventTypes, handler) => EventCenter.onMany(moduleId, eventTypes, handler),
        off: (eventType, handler) => EventCenter.off(moduleId, eventType, handler),
        cleanup: () => EventCenter.cleanup(moduleId),
        count: () => EventCenter.count(moduleId),
        // 模块间通信
        emit: (eventName, data) => EventCenter.emit(eventName, data),
        subscribe: (eventName, handler) => EventCenter.subscribe(moduleId, eventName, handler),
        unsubscribe: (eventName) => EventCenter.unsubscribe(moduleId, eventName),
    };
}

// 暴露到 window 供调试
if (typeof window !== 'undefined') {
    window.xbEventCenter = {
        stats: () => EventCenter.stats(),
        modules: () => Array.from(registry.keys()),
        detail: (moduleId) => {
            const listeners = registry.get(moduleId);
            if (!listeners) return `模块 "${moduleId}" 未注册`;
            return listeners.map(l => l.eventType).join(', ');
        },
        help: () => console.log(`
📊 小白X 事件管理器调试命令:
  xbEventCenter.stats()        - 查看所有模块的事件数量
  xbEventCenter.modules()      - 列出所有已注册模块
  xbEventCenter.detail('模块名') - 查看模块监听的事件类型
        `)
    };
}

// 导出 event_types 方便模块使用
export { event_types };
