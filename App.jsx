import '@generated/theme-tokens.css';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@components/ui/tabs';
import { ProjectExplorer } from '@generated/components/ProjectExplorer';
import { PortfolioIntel } from '@generated/components/PortfolioIntel';
import { BrandHeader } from '@generated/components/BrandHeader';
import { useProjects } from '@generated/hooks/useProjects';

export default function App() {
  const [activeTab, setActiveTab] = useState('explorer');
  const projectsData = useProjects();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <BrandHeader />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="explorer">Project Explorer</TabsTrigger>
          <TabsTrigger value="intel">Portfolio Intelligence</TabsTrigger>
        </TabsList>

        {activeTab === 'explorer' && (
          <TabsContent value="explorer" className="mt-4">
            <ProjectExplorer {...projectsData} />
          </TabsContent>
        )}

        {activeTab === 'intel' && (
          <TabsContent value="intel" className="mt-4">
            <PortfolioIntel
              projects={projectsData.projects}
              loading={projectsData.loading}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
