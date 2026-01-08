import React, { useState, useEffect } from 'react';
import { IoIosCube } from 'react-icons/io';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';

// Define FileInfo interface locally
interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: Date;
}

interface FileTreeItemProps {
  file: FileInfo;
  isSelected: boolean;
  onSelect: (path: string) => void;
}

function FileTreeItem({ file, isSelected, onSelect }: FileTreeItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="gap-1 cursor-pointer"
        onClick={() => onSelect(file.path)}
        isActive={isSelected}
      >
        <IoIosCube
          className="size-sidebar-icon fill-gray-400"
        />
        <span>{file.name}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

interface FileTreeProps {
  rootPath: string | null;
  selectedScene: string | null;
  onSceneSelect: (path: string) => void;
}

export function FileTree({ rootPath, selectedScene, onSceneSelect }: FileTreeProps) {
  const [rootFiles, setRootFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!rootPath) {
      setRootFiles([]);
      return;
    }

    const loadRootDirectory = async () => {
      setIsLoading(true);
      try {
        const files = await window.electron.readDirectory(rootPath);

        // Check which root directories are scene folders
        const dirItems = files.filter(item => item.isDirectory);
        const newCache = new Map<string, boolean>();
        for (const dir of dirItems) {
          const isScene = await window.electron.checkSceneFolder(dir.path);
          newCache.set(dir.path, isScene);
        }

        // Filter to only show scene folders, sorted alphabetically
        const sceneFolders = files.filter(file =>
          file.isDirectory && newCache.get(file.path) === true
        ).sort((a, b) => a.name.localeCompare(b.name));

        setRootFiles(sceneFolders);
      } catch (error) {
        console.error('Error loading root directory:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadRootDirectory();
  }, [rootPath]);

  if (!rootPath) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-sidebar-foreground/70">
        No folder opened
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-sidebar-foreground/70">
        Loading...
      </div>
    );
  }

  return (
    <SidebarMenu>
      {rootFiles.map((file) => (
        <FileTreeItem
          key={file.path}
          file={file}
          isSelected={selectedScene === file.path}
          onSelect={onSceneSelect}
        />
      ))}
    </SidebarMenu>
  );
}
