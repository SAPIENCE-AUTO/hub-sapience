import React, { createContext, useContext, useState } from 'react';
import type { GetProjectsOutputType } from 'zite-endpoints-sdk';

type Project = GetProjectsOutputType['projects'][0];

interface ProjectContextType {
  selectedProject: string | null;
  setSelectedProject: (code: string | null) => void;
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  projectsLoading: boolean;
  setProjectsLoading: (loading: boolean) => void;
}

const ProjectContext = createContext<ProjectContextType>({
  selectedProject: null,
  setSelectedProject: () => {},
  projects: [],
  setProjects: () => {},
  projectsLoading: true,
  setProjectsLoading: () => {},
});

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  return (
    <ProjectContext.Provider value={{ selectedProject, setSelectedProject, projects, setProjects, projectsLoading, setProjectsLoading }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => useContext(ProjectContext);
