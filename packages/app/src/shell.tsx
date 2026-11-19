// TessloShell：Launcher ↔ 编辑器路由（D2：默认卸载重建，状态不跨会话）。
import React, {useState} from 'react';
import type {PlatformAdapter, ProjectSummary} from '@tesslo/platform-adapter';
import {ProjectList} from './launcher/project-list.tsx';
import {EditorPane} from './editor/editor-pane.tsx';

// Shell 参数
export interface ShellProps {
    readonly adapter: PlatformAdapter;
    readonly locale: string;
    readonly logo?: string;
    readonly version?: string;
    readonly onOpenAbout?: () => void;
    // 导出钩子：装配层注入（列表页三格式 + 编辑器内快捷键共用）；
    // true = 已完成导出，false = 取消/失败（失败时装配层已弹提示）
    readonly onExportProject?: (
        project: ProjectSummary,
        format: 'tess' | 'sb3' | 'html'
    ) => Promise<boolean> | void;
}

/**
 * 应用外壳：首屏作品列表，点开项目挂编辑器，logo 返回列表。
 *
 * @param props - 适配器、语言与装配层注入的展示项。
 * @returns Shell JSX。
 */
export const TessloShell = ({adapter, locale, logo, version, onOpenAbout,
    onExportProject}: ShellProps): React.JSX.Element => {
    const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);

    if (activeProject) {
        return (
            <EditorPane
                key={activeProject.id}
                project={activeProject}
                adapter={adapter}
                locale={locale}
                logo={logo}
                onExit={() => setActiveProject(null)}
                onExportProject={onExportProject}
            />
        );
    }
    return (
        <ProjectList
            adapter={adapter}
            logo={logo}
            version={version}
            onOpenAbout={onOpenAbout}
            onOpenProject={project => setActiveProject(project)}
            onExportProject={onExportProject}
        />
    );
};
