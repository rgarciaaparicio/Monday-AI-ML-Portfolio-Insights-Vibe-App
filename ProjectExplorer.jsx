import { Input } from '@components/ui/input';
import { Button } from '@components/ui/button';
import { Skeleton } from '@components/ui/skeleton';
import { Spinner } from '@components/ui/spinner';
import { Search } from 'lucide-react';
import { ProjectInsightCard } from '@generated/components/ProjectInsightCard';

export function ProjectExplorer({
  projects, loading, loadingMore, refetching, cursor, search, loadMore, searchTerm
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const docsCount = projects.filter(p => p._docId).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={searchTerm}
            onChange={(e) => search(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground shrink-0">
          {projects.length} projects · {docsCount} with documents
        </p>
      </div>

      <div className={`space-y-3 transition-opacity duration-200 ${refetching ? 'opacity-50' : ''}`}>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No projects found
          </p>
        ) : (
          projects.map((project) => (
            <ProjectInsightCard key={project.id} project={project} />
          ))
        )}
      </div>

      {cursor && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Spinner className="mr-2 h-4 w-4" />}
            {loadingMore ? 'Loading...' : 'Load More Projects'}
          </Button>
        </div>
      )}
    </div>
  );
}
