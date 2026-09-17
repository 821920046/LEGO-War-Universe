/**
 * LEGO War Universe - 多影片工程存储管理器
 * 支持多项目管理、导入导出校验、连续性元数据持久化
 */
const VERSION = '2';

export class ProjectStore {
  constructor({ storage = globalThis.localStorage, key = 'lwu_projects' } = {}) {
    this.storage = storage;
    this.key = key;
  }

  /**
   * 创建空白工程
   * @param {string} name 影片名称
   * @returns {object} 空白工程对象
   */
  emptyProject(name = '未命名影片') {
    return {
      id: crypto.randomUUID?.() || `proj_${Date.now()}`,
      schemaVersion: VERSION,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      shots: [],
      continuity: {},
      reviewQueue: []
    };
  }

  /**
   * 创建空白多工程容器
   */
  emptyStore() {
    return {
      storeVersion: '1',
      currentProjectId: null,
      projects: []
    };
  }

  /**
   * 加载所有工程
   * @returns {Promise<object>} 多工程容器
   */
  async loadAll() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return this.emptyStore();
      const parsed = JSON.parse(raw);
      // 兼容旧版单工程格式迁移
      if (parsed.schemaVersion === '1' && Array.isArray(parsed.shots)) {
        const migrated = this.emptyStore();
        const project = {
          ...this.emptyProject('旧版迁移工程'),
          shots: parsed.shots,
          continuity: parsed.continuity || {}
        };
        migrated.projects.push(project);
        migrated.currentProjectId = project.id;
        return migrated;
      }
      return parsed;
    } catch {
      return this.emptyStore();
    }
  }

  /**
   * 保存所有工程
   * @param {object} store 多工程容器
   */
  async saveAll(store) {
    store.projects.forEach(p => { p.updatedAt = new Date().toISOString(); });
    this.storage?.setItem(this.key, JSON.stringify(store));
    return store;
  }

  /**
   * 获取当前激活工程
   * @param {object} store 多工程容器
   * @returns {object|null} 当前工程
   */
  getCurrentProject(store) {
    if (!store.currentProjectId) return store.projects[0] || null;
    return store.projects.find(p => p.id === store.currentProjectId) || store.projects[0] || null;
  }

  /**
   * 创建新工程并切换
   * @param {object} store 多工程容器
   * @param {string} name 工程名
   * @returns {object} 更新后的容器
   */
  createProject(store, name) {
    const project = this.emptyProject(name);
    store.projects.push(project);
    store.currentProjectId = project.id;
    return store;
  }

  /**
   * 删除工程
   * @param {object} store 多工程容器
   * @param {string} projectId 工程 ID
   * @returns {object} 更新后的容器
   */
  deleteProject(store, projectId) {
    store.projects = store.projects.filter(p => p.id !== projectId);
    if (store.currentProjectId === projectId) {
      store.currentProjectId = store.projects[0]?.id || null;
    }
    return store;
  }

  /**
   * 重命名工程
   * @param {object} store 多工程容器
   * @param {string} projectId 工程 ID
   * @param {string} newName 新名称
   * @returns {object} 更新后的容器
   */
  renameProject(store, projectId, newName) {
    const project = store.projects.find(p => p.id === projectId);
    if (project) project.name = newName;
    return store;
  }

  /**
   * 导入工程 JSON
   * @param {string} text JSON 文本
   * @returns {{ project?: object, violations?: Array<object> }}
   */
  async import(text) {
    try {
      const project = JSON.parse(text);
      // 兼容旧版 schemaVersion '1'
      if (project.schemaVersion === '1') {
        project.schemaVersion = VERSION;
        project.id = project.id || crypto.randomUUID?.() || `proj_${Date.now()}`;
        project.name = project.name || '导入工程';
        project.createdAt = project.createdAt || new Date().toISOString();
        project.updatedAt = new Date().toISOString();
        project.reviewQueue = project.reviewQueue || [];
      }
      if (project.schemaVersion !== VERSION) {
        return { violations: [{ code: 'UNSUPPORTED_PROJECT_SCHEMA' }] };
      }
      if (!Array.isArray(project.shots) || typeof project.continuity !== 'object') {
        return { violations: [{ code: 'INVALID_PROJECT' }] };
      }
      return { project };
    } catch {
      return { violations: [{ code: 'INVALID_JSON' }] };
    }
  }

  /**
   * 导出工程为 JSON 字符串
   * @param {object} project 工程对象
   * @returns {string} JSON 字符串
   */
  export(project) {
    return JSON.stringify(project, null, 2);
  }
}
